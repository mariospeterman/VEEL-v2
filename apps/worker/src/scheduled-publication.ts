import { randomUUID } from "node:crypto";
import postgres from "postgres";

export interface LeasedScheduledPublication {
  contentItemId: string;
  creatorUserId: string;
  leaseToken: string;
  attemptCount: number;
}

export interface ScheduledPublicationRepository {
  leaseDue(input: { now: Date; limit: number; leaseDurationMs: number }): Promise<LeasedScheduledPublication[]>;
  publishLeased(input: { publication: LeasedScheduledPublication; now: Date }): Promise<"completed" | "retry" | "dead_letter">;
  close?(): Promise<void>;
}

export interface ProcessScheduledPublicationsResult {
  leased: number;
  completed: number;
  retrying: number;
  deadLettered: number;
}

export async function processScheduledPublications(input: {
  repository: ScheduledPublicationRepository;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
}): Promise<ProcessScheduledPublicationsResult> {
  const now = input.now ?? new Date();
  const publications = await input.repository.leaseDue({
    now,
    limit: input.limit ?? 25,
    leaseDurationMs: input.leaseDurationMs ?? 5 * 60 * 1000
  });
  const result = { leased: publications.length, completed: 0, retrying: 0, deadLettered: 0 };
  for (const publication of publications) {
    const outcome = await input.repository.publishLeased({ publication, now });
    if (outcome === "completed") result.completed += 1;
    else if (outcome === "retry") result.retrying += 1;
    else result.deadLettered += 1;
  }
  return result;
}

export function createPostgresScheduledPublicationRepository(databaseUrl?: string): ScheduledPublicationRepository {
  if (!databaseUrl) {
    return {
      async leaseDue() { return []; },
      async publishLeased() { return "retry"; }
    };
  }
  const sql = postgres(databaseUrl, { max: 4 });
  return {
    async leaseDue(input) {
      return sql.begin(async (transaction) => {
        await transaction`
          update content_publication_jobs
          set
            state = 'dead_letter',
            lease_token = null,
            leased_until = null,
            last_error_code = 'lease_attempts_exhausted',
            updated_at = now()
          where state = 'leased'
            and leased_until <= ${input.now}
            and attempt_count >= 8
        `;
        const rows = await transaction<Array<{
          content_item_id: string;
          creator_user_id: string;
          attempt_count: number;
        }>>`
          select content_item_id, creator_user_id, attempt_count
          from content_publication_jobs
          where scheduled_for <= ${input.now}
            and next_attempt_at <= ${input.now}
            and attempt_count < 8
            and (
              state in ('queued', 'retry')
              or (state = 'leased' and leased_until <= ${input.now})
            )
          order by next_attempt_at, scheduled_for, content_item_id
          for update skip locked
          limit ${input.limit}
        `;
        const leased: LeasedScheduledPublication[] = [];
        for (const row of rows) {
          const leaseToken = randomUUID();
          const updated = await transaction<{ content_item_id: string; attempt_count: number }[]>`
            update content_publication_jobs
            set
              state = 'leased',
              attempt_count = attempt_count + 1,
              lease_token = ${leaseToken},
              leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
              updated_at = now()
            where content_item_id = ${row.content_item_id}
              and state in ('queued', 'retry', 'leased')
            returning content_item_id, attempt_count
          `;
          if (!updated[0]) continue;
          leased.push({
            contentItemId: row.content_item_id,
            creatorUserId: row.creator_user_id,
            leaseToken,
            attemptCount: Number(updated[0].attempt_count)
          });
        }
        return leased;
      });
    },
    async publishLeased(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<Array<{
          content_item_id: string;
          creator_user_id: string;
          attempt_count: number;
          publish_state: string;
          distribution_mode: "post" | "moment";
          terminally_blocked: boolean;
          release_ready: boolean;
        }>>`
          select
            job.content_item_id,
            job.creator_user_id,
            job.attempt_count,
            content.publish_state,
            content.distribution_mode,
            (content.state in ('blocked', 'deleted') or content.moderation_state = 'blocked' or creator.state <> 'active') as terminally_blocked,
            (
              content.publish_state = 'scheduled'
              and content.scheduled_for <= ${input.now}
              and content.moderation_state = 'approved'
              and (content.state = 'ready' or content.media_type in ('text', 'poll'))
              and private.content_safety_release_ready(content.id)
              and private.content_composition_provider_ready(content.id)
            ) as release_ready
          from content_publication_jobs job
          join content_items content on content.id = job.content_item_id
          join users creator on creator.id = content.creator_user_id
          where job.content_item_id = ${input.publication.contentItemId}
            and job.state = 'leased'
            and job.lease_token = ${input.publication.leaseToken}
          for update of job, content
        `;
        const current = rows[0];
        if (!current) return "retry" as const;

        if (current.release_ready) {
          await transaction`
            update content_items
            set
              publish_state = 'published',
              published_at = coalesce(published_at, ${input.now}),
              expires_at = case
                when distribution_mode = 'moment' then ${new Date(input.now.getTime() + 24 * 60 * 60 * 1000)}
                else expires_at
              end,
              updated_at = now()
            where id = ${current.content_item_id}
              and publish_state = 'scheduled'
          `;
          await transaction`
            insert into notifications (
              id, user_id, kind, title, body, action_url,
              related_resource_type, related_resource_id, idempotency_key
            ) values (
              ${randomUUID()}, ${current.creator_user_id}, 'studio_setup',
              'Scheduled post is live', 'Your scheduled post passed its final checks and is now visible.',
              ${`/content/${current.content_item_id}`}, 'content', ${current.content_item_id},
              ${`scheduled-publication:${current.content_item_id}:completed`}
            ) on conflict (user_id, idempotency_key) do nothing
          `;
          await recordAudit(transaction, current.creator_user_id, current.content_item_id, current.attempt_count, "content_scheduled_publication_completed", null);
          return "completed" as const;
        }

        const deadLettered = current.terminally_blocked || current.attempt_count >= 8;
        const state = deadLettered ? "dead_letter" : "retry";
        const errorCode = current.terminally_blocked ? "release_blocked" : "release_evidence_incomplete";
        await transaction`
          update content_publication_jobs
          set
            state = ${state},
            next_attempt_at = ${new Date(input.now.getTime() + retryDelayMs(current.attempt_count))},
            lease_token = null,
            leased_until = null,
            last_error_code = ${errorCode},
            updated_at = now()
          where content_item_id = ${current.content_item_id}
            and lease_token = ${input.publication.leaseToken}
        `;
        if (deadLettered) {
          await transaction`
            insert into notifications (
              id, user_id, kind, title, body, action_url,
              related_resource_type, related_resource_id, idempotency_key
            ) values (
              ${randomUUID()}, ${current.creator_user_id}, 'studio_setup',
              'Scheduled post needs attention', 'Open Studio to review the publishing checks before trying again.',
              '/app/studio#content', 'content', ${current.content_item_id},
              ${`scheduled-publication:${current.content_item_id}:blocked`}
            ) on conflict (user_id, idempotency_key) do nothing
          `;
        }
        await recordAudit(
          transaction,
          current.creator_user_id,
          current.content_item_id,
          current.attempt_count,
          deadLettered ? "content_scheduled_publication_dead_lettered" : "content_scheduled_publication_retry",
          errorCode
        );
        return deadLettered ? "dead_letter" as const : "retry" as const;
      });
    },
    async close() { await sql.end({ timeout: 5 }); }
  };
}

async function recordAudit(
  sql: postgres.TransactionSql,
  actorUserId: string,
  contentItemId: string,
  attemptCount: number,
  action: string,
  errorCode: string | null
) {
  await sql`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
    ) values (
      ${randomUUID()}, ${actorUserId}, 'content', ${contentItemId}, ${action},
      ${`worker:scheduled-publication:${contentItemId}:${attemptCount}:${action}`},
      ${sql.json({ attemptCount, errorCode })}::jsonb
    ) on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
    do nothing
  `;
}

function retryDelayMs(attemptCount: number) {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(attemptCount, 6));
}
