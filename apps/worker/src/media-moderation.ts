import postgres from "postgres";

export interface QueuedMediaModerationJob {
  jobId: string;
  caseId: string;
  targetType: "media_asset" | "live_room";
  mediaAssetId: string | null;
  liveRoomId: string | null;
  provider: "bunny" | "livepeer";
  providerAssetId: string;
  stage: string;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
}

export type MediaModerationOutcome =
  | { state: "clear"; provider: "bunny_shield" | "livepeer" | "internal"; payloadHash: string }
  | { state: "review_required"; reasonCode: string }
  | { state: "failed"; failureCode: string };

export interface MediaModerationAdapter {
  evaluate(job: QueuedMediaModerationJob): Promise<MediaModerationOutcome>;
}

export interface MediaModerationRepository {
  leaseJobs(input: {
    now: Date;
    limit: number;
    leaseDurationMs: number;
  }): Promise<QueuedMediaModerationJob[]>;
  recordOutcome(input: {
    job: QueuedMediaModerationJob;
    outcome: MediaModerationOutcome;
    now: Date;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface ProcessMediaModerationResult {
  leased: number;
  completed: number;
  reviewRequired: number;
  failed: number;
}

export async function processMediaModerationJobs(input: {
  repository: MediaModerationRepository;
  adapter: MediaModerationAdapter;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
}): Promise<ProcessMediaModerationResult> {
  const now = input.now ?? new Date();
  const jobs = await input.repository.leaseJobs({
    now,
    limit: input.limit ?? 25,
    leaseDurationMs: input.leaseDurationMs ?? 5 * 60 * 1000
  });
  const result: ProcessMediaModerationResult = {
    leased: jobs.length,
    completed: 0,
    reviewRequired: 0,
    failed: 0
  };

  for (const job of jobs) {
    const outcome = await input.adapter.evaluate(job).catch(
      (error: unknown): MediaModerationOutcome => ({
        state: "failed",
        failureCode: moderationFailureCode(error)
      })
    );
    await input.repository.recordOutcome({ job, outcome, now });

    if (outcome.state === "clear") result.completed += 1;
    if (outcome.state === "review_required") result.reviewRequired += 1;
    if (outcome.state === "failed") result.failed += 1;
  }

  return result;
}

export function createFailClosedMediaModerationAdapter(): MediaModerationAdapter {
  return {
    async evaluate() {
      return {
        state: "review_required",
        reasonCode: "automated_media_moderation_not_launch_approved"
      };
    }
  };
}

export function createPostgresMediaModerationRepository(
  databaseUrl?: string
): MediaModerationRepository {
  if (!databaseUrl) {
    return {
      async leaseJobs() {
        return [];
      },
      async recordOutcome() {
        return;
      }
    };
  }

  const sql = postgres(databaseUrl, { max: 3, idle_timeout: 20, prepare: false });

  return {
    async leaseJobs(input) {
      return sql.begin(async (transaction) => {
        await transaction`
          update media_moderation_jobs
          set
            state = 'dead_letter',
            last_failure_code = coalesce(last_failure_code, 'moderation_attempt_limit_exceeded'),
            lease_token = null,
            leased_at = null,
            lease_expires_at = null,
            updated_at = now()
          where state in ('queued', 'retry', 'processing')
            and attempt_count >= max_attempts
            and (state <> 'processing' or lease_expires_at is null or lease_expires_at <= ${input.now})
        `;

        const rows = await transaction<QueuedMediaModerationJobRow[]>`
          update media_moderation_jobs mmj
          set
            state = 'processing',
            lease_token = gen_random_uuid(),
            leased_at = ${input.now},
            lease_expires_at = ${new Date(input.now.getTime() + input.leaseDurationMs)},
            attempt_count = mmj.attempt_count + 1,
            updated_at = now()
          from (
            select id, media_asset_id, live_room_id
            from media_moderation_jobs
            where (
                (state in ('queued', 'retry') and next_attempt_at <= ${input.now})
                or (state = 'processing' and (lease_expires_at is null or lease_expires_at <= ${input.now}))
              )
              and attempt_count < max_attempts
              and (
                exists (
                  select 1
                  from media_assets ready_asset
                  where ready_asset.id = media_moderation_jobs.media_asset_id
                    and ready_asset.provider_playable is true
                    and ready_asset.ready_at is not null
                )
                or exists (
                  select 1
                  from live_rooms ready_room
                  where ready_room.id = media_moderation_jobs.live_room_id
                    and ready_room.provider_stream_id is not null
                    and ready_room.state in ('waiting', 'live')
                )
              )
            order by next_attempt_at asc, created_at asc
            limit ${input.limit}
            for update skip locked
          ) due
          left join media_assets ma on ma.id = due.media_asset_id
          left join live_rooms lr on lr.id = due.live_room_id
          where mmj.id = due.id
          returning
            mmj.id as job_id,
            mmj.media_safety_case_id as case_id,
            mmj.media_asset_id,
            mmj.live_room_id,
            case when mmj.live_room_id is not null then 'livepeer' else ma.provider end as provider,
            coalesce(lr.provider_stream_id, ma.provider_asset_id) as provider_asset_id,
            mmj.stage,
            mmj.attempt_count,
            mmj.max_attempts,
            mmj.lease_token
        `;

        return rows.map((row) => ({
          jobId: row.job_id,
          caseId: row.case_id,
          mediaAssetId: row.media_asset_id,
          liveRoomId: row.live_room_id,
          targetType: row.live_room_id ? "live_room" : "media_asset",
          provider: row.provider,
          providerAssetId: row.provider_asset_id,
          stage: row.stage,
          attemptCount: row.attempt_count,
          maxAttempts: row.max_attempts,
          leaseToken: row.lease_token
        }));
      });
    },

    async recordOutcome(input) {
      if (input.outcome.state === "failed") {
        await sql`
          update media_moderation_jobs
          set
            state = case when attempt_count >= max_attempts then 'dead_letter' else 'retry' end,
            last_failure_code = ${input.outcome.failureCode},
            next_attempt_at = ${input.now} + make_interval(
              secs => least(3600, 30 * power(2, least(attempt_count, 7)))::integer
            ),
            lease_token = null,
            leased_at = null,
            lease_expires_at = null,
            updated_at = now()
          where id = ${input.job.jobId}
            and state = 'processing'
            and lease_token = ${input.job.leaseToken}
        `;
        return;
      }

      const reasonCode =
        input.outcome.state === "clear"
          ? "provider_scan_clear_manual_release_required"
          : input.outcome.reasonCode;

      await sql.begin(async (transaction) => {
        const jobRows = await transaction<{ media_safety_case_id: string }[]>`
          update media_moderation_jobs
          set
            state = ${input.outcome.state === "clear" ? "completed" : "review_required"},
            last_failure_code = null,
            lease_token = null,
            leased_at = null,
            lease_expires_at = null,
            updated_at = now()
          where id = ${input.job.jobId}
            and state = 'processing'
            and lease_token = ${input.job.leaseToken}
          returning media_safety_case_id
        `;
        if (!jobRows[0]) return;

        if (input.outcome.state === "clear") {
          await transaction`
            insert into provider_media_scan_events (
              media_safety_case_id,
              provider,
              scan_type,
              normalized_signal,
              payload_hash,
              observed_at
            )
            values (
              ${input.job.caseId},
              ${input.outcome.provider},
              ${input.job.targetType === "live_room" ? "live_signal" : "known_hash"},
              'clear',
              ${input.outcome.payloadHash},
              ${input.now}
            )
          `;
        }

        await transaction`
          update media_safety_cases
          set
            state = 'review_required',
            reason_code = ${reasonCode},
            provider_release_allowed = false,
            updated_at = now()
          where id = ${input.job.caseId}
            and state not in ('rejected', 'held_for_reporting', 'superseded')
        `;
      });
    },

    async close() {
      await sql.end();
    }
  };
}

interface QueuedMediaModerationJobRow {
  job_id: string;
  case_id: string;
  media_asset_id: string | null;
  live_room_id: string | null;
  provider: "bunny" | "livepeer";
  provider_asset_id: string;
  stage: string;
  attempt_count: number;
  max_attempts: number;
  lease_token: string;
}

function moderationFailureCode(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `media_moderation_exception:${error.message.slice(0, 80)}`;
  }
  return "media_moderation_exception";
}
