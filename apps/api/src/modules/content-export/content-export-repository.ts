import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { executeWithMutationCommandReceipt } from "../../shared/mutation-command-receipt.js";
import type { PostgresSql, PostgresTransaction } from "../../shared/postgres.js";
import { ContentExportPolicyError, ContentExportRepositoryConfigurationError } from "./content-export-errors.js";
import type {
  AuthorizedContentExportDownload,
  ContentExportDownloadGrantResource,
  ContentExportRepository,
  ContentExportResource,
  ContentExportState
} from "./types.js";

interface ContentExportRow {
  id: string;
  data_request_id: string;
  state: ContentExportState;
  progress_total_items: number;
  progress_completed_items: number;
  progress_available_items: number;
  progress_unavailable_items: number;
  attempt_count: number;
  last_error_code: string | null;
  snapshot_created_at: Date;
  archive_ready_at: Date | null;
  downloadable_until: Date | null;
}

interface DownloadRow {
  archive_object_key: string;
  archive_byte_size: number;
  archive_sha256: string;
  requester_user_id: string;
}

export function createPostgresContentExportRepository(
  sql?: PostgresSql
): ContentExportRepository {
  if (!sql) {
    const unavailable = async (): Promise<never> => {
      throw new ContentExportRepositoryConfigurationError();
    };
    return {
      cancel: unavailable,
      retry: unavailable,
      createDownloadGrant: unavailable,
      authorizeDownload: unavailable
    };
  }

  return {
    async cancel(input) {
      return sql.begin(async (transaction) => {
        const actorUserId = input.userId;
        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "content_export.cancel",
          targetType: "content_export",
          targetId: input.jobId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: {},
          responseStatus: 200
        }, async () => {
          const rows = await ownedJobForUpdate(transaction, actorUserId, input.jobId);
          const job = rows[0];
          if (!job) return null;
          if (job.state === "cancelled") return toResource(job);
          if (!["queued", "retry", "processing", "dead_letter"].includes(job.state)) {
            throw new ContentExportPolicyError("This content export can no longer be cancelled");
          }
          const updated = await transaction<ContentExportRow[]>`
            update content_export_jobs
            set state = case when state = 'processing' then state else 'cancelled' end,
                cancel_requested_at = coalesce(cancel_requested_at, clock_timestamp()),
                next_attempt_at = case when state = 'processing' then next_attempt_at else null end,
                last_error_code = case when state = 'processing' then last_error_code else null end,
                updated_at = clock_timestamp()
            where id = ${input.jobId} and requester_user_id = ${actorUserId}
            returning id, data_request_id, state, progress_total_items,
              progress_completed_items, progress_available_items,
              progress_unavailable_items, attempt_count, last_error_code,
              snapshot_created_at, archive_ready_at, downloadable_until
          `;
          if (job.state !== "processing") {
            await transaction`
              update data_requests
              set state = 'cancelled', reason = 'cancelled_by_requester',
                  updated_at = clock_timestamp(), completed_at = null
              where id = ${job.data_request_id} and type = 'export'
            `;
          }
          await insertAudit(transaction, {
            actorUserId,
            jobId: input.jobId,
            action: "content_export_cancel_requested",
            idempotencyKey: input.idempotencyKey,
            metadata: { processingFence: job.state === "processing" }
          });
          return updated[0] ? toResource(updated[0]) : null;
        });
      }) as Promise<ContentExportResource | null>;
    },

    async retry(input) {
      return sql.begin(async (transaction) => {
        const actorUserId = input.userId;
        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "content_export.retry",
          targetType: "content_export",
          targetId: input.jobId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: {},
          responseStatus: 200
        }, async () => {
          const rows = await ownedJobForUpdate(transaction, actorUserId, input.jobId);
          const job = rows[0];
          if (!job) return null;
          if (job.state !== "dead_letter") {
            throw new ContentExportPolicyError("Only a failed content export can be retried");
          }
          // Serialize against createDataRequest, which locks the same actor row,
          // so the partial unique index cannot surface as an unhandled 23505.
          await transaction`select id from users where id = ${actorUserId} for update`;
          const active = await transaction<{ id: string }[]>`
            select id
            from content_export_jobs
            where requester_user_id = ${actorUserId}
              and id <> ${input.jobId}
              and state in ('queued', 'processing', 'retry')
            limit 1
          `;
          if (active[0]) {
            throw new ContentExportPolicyError("Another content export is already active");
          }
          const updated = await transaction<ContentExportRow[]>`
            update content_export_jobs
            set state = 'queued', attempt_count = 0, next_attempt_at = clock_timestamp(),
                lease_token = null, leased_until = null, cancel_requested_at = null,
                last_error_code = null, source_hold_until = clock_timestamp() + interval '24 hours',
                progress_completed_items = (
                  select count(*)::integer from content_export_job_items
                  where job_id = ${input.jobId} and initial_unavailable_reason is not null
                ),
                progress_available_items = 0,
                progress_unavailable_items = (
                  select count(*)::integer from content_export_job_items
                  where job_id = ${input.jobId} and initial_unavailable_reason is not null
                ),
                updated_at = clock_timestamp()
            where id = ${input.jobId} and requester_user_id = ${actorUserId}
            returning id, data_request_id, state, progress_total_items,
              progress_completed_items, progress_available_items,
              progress_unavailable_items, attempt_count, last_error_code,
              snapshot_created_at, archive_ready_at, downloadable_until
          `;
          await transaction`
            update content_export_job_items
            set state = case when initial_unavailable_reason is null then 'pending' else 'unavailable' end,
                unavailable_reason = initial_unavailable_reason, archive_path = null,
                exported_byte_size = null, exported_sha256 = null,
                processed_at = case when initial_unavailable_reason is null then null else clock_timestamp() end
            where job_id = ${input.jobId}
          `;
          await transaction`
            update data_requests
            set state = 'requested', reason = null, updated_at = clock_timestamp(), completed_at = null
            where id = ${job.data_request_id} and type = 'export'
          `;
          await insertAudit(transaction, {
            actorUserId,
            jobId: input.jobId,
            action: "content_export_retry_requested",
            idempotencyKey: input.idempotencyKey,
            metadata: { sourceHoldHours: 24 }
          });
          return updated[0] ? toResource(updated[0]) : null;
        });
      }) as Promise<ContentExportResource | null>;
    },

    async createDownloadGrant(input) {
      return sql.begin(async (transaction) => {
        const actorUserId = input.userId;
        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "content_export.download_grant.create",
          targetType: "content_export",
          targetId: input.jobId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: {},
          responseStatus: 201
        }, async () => {
          const jobs = await transaction<Array<{ downloadable_until: Date }>>`
            select downloadable_until
            from content_export_jobs
            where id = ${input.jobId}
              and requester_user_id = ${actorUserId}
              and state = 'ready'
              and cleanup_state = 'retained_private'
              and downloadable_until > ${input.now}
              and not exists (
                select 1
                from content_export_job_contents snapshot
                join content_items current_content on current_content.id = snapshot.content_item_id
                where snapshot.job_id = content_export_jobs.id
                  and current_content.state::text in ('blocked', 'deleted')
              )
            for update
          `;
          const job = jobs[0];
          if (!job) return null;
          const grantId = randomUUID();
          const expiresAt = new Date(Math.min(
            input.now.getTime() + 5 * 60 * 1000,
            job.downloadable_until.getTime()
          ));
          await transaction`
            insert into content_export_download_grants (
              id, job_id, requester_user_id, idempotency_key, expires_at, created_at
            ) values (
              ${grantId}, ${input.jobId}, ${actorUserId}, ${input.idempotencyKey},
              ${expiresAt}, ${input.now}
            )
          `;
          const result: ContentExportDownloadGrantResource = {
            id: grantId,
            contentExportId: input.jobId,
            expiresAt: expiresAt.toISOString(),
            downloadUrl: `/v1/privacy/content-exports/${input.jobId}/downloads/${grantId}`
          };
          await insertAudit(transaction, {
            actorUserId,
            jobId: input.jobId,
            action: "content_export_download_grant_created",
            idempotencyKey: input.idempotencyKey,
            metadata: { grantId, expiresAt: result.expiresAt }
          });
          return result;
        });
      }) as Promise<ContentExportDownloadGrantResource | null>;
    },

    async authorizeDownload(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<DownloadRow[]>`
          select job.archive_object_key, job.archive_byte_size, job.archive_sha256,
            job.requester_user_id
          from users actor
          join content_export_download_grants grant on grant.requester_user_id = actor.id
          join content_export_jobs job on job.id = grant.job_id
            and job.requester_user_id = actor.id
          where actor.id = ${input.userId}::uuid
            and grant.id = ${input.grantId}
            and grant.job_id = ${input.jobId}
            and grant.expires_at > ${input.now}
            and grant.last_accessed_at is null
            and job.state = 'ready'
            and job.cleanup_state = 'retained_private'
            and job.downloadable_until > ${input.now}
            and not exists (
              select 1
              from content_export_job_contents snapshot
              join content_items current_content on current_content.id = snapshot.content_item_id
              where snapshot.job_id = job.id
                and current_content.state::text in ('blocked', 'deleted')
            )
          for update of grant
        `;
        const row = rows[0];
        if (!row) return null;
        await transaction`
          update content_export_download_grants
          set last_accessed_at = ${input.now}
          where id = ${input.grantId} and job_id = ${input.jobId}
            and last_accessed_at is null
        `;
        await insertAudit(transaction, {
          actorUserId: row.requester_user_id,
          jobId: input.jobId,
          action: "content_export_download_authorized",
          idempotencyKey: `grant:${input.grantId}:first-access`,
          metadata: { grantId: input.grantId }
        });
        const result: AuthorizedContentExportDownload = {
          archiveObjectKey: row.archive_object_key,
          archiveByteSize: Number(row.archive_byte_size),
          archiveSha256: row.archive_sha256,
          filename: `wevid-content-export-${input.jobId}.tar`
        };
        return result;
      }) as Promise<AuthorizedContentExportDownload | null>;
    }
  };
}

async function ownedJobForUpdate(
  transaction: PostgresTransaction,
  actorUserId: string,
  jobId: string
): Promise<ContentExportRow[]> {
  return await transaction<ContentExportRow[]>`
    select id, data_request_id, state, progress_total_items,
      progress_completed_items, progress_available_items,
      progress_unavailable_items, attempt_count, last_error_code,
      snapshot_created_at, archive_ready_at, downloadable_until
    from content_export_jobs
    where id = ${jobId} and requester_user_id = ${actorUserId}
    for update
  `;
}

function toResource(row: ContentExportRow): ContentExportResource {
  const canDownload = row.state === "ready"
    && row.downloadable_until !== null
    && row.downloadable_until.getTime() > Date.now();
  return {
    id: row.id,
    dataRequestId: row.data_request_id,
    state: row.state,
    progress: {
      totalItems: Number(row.progress_total_items),
      completedItems: Number(row.progress_completed_items),
      availableItems: Number(row.progress_available_items),
      unavailableItems: Number(row.progress_unavailable_items)
    },
    attemptCount: Number(row.attempt_count),
    lastErrorCode: row.last_error_code,
    snapshotCreatedAt: row.snapshot_created_at.toISOString(),
    archiveReadyAt: row.archive_ready_at?.toISOString() ?? null,
    downloadableUntil: row.downloadable_until?.toISOString() ?? null,
    canCancel: ["queued", "processing", "retry", "dead_letter"].includes(row.state),
    canRetry: row.state === "dead_letter",
    canDownload
  };
}

async function insertAudit(
  transaction: PostgresTransaction,
  input: {
    actorUserId: string;
    jobId: string;
    action: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
    ) values (
      ${randomUUID()}, ${input.actorUserId}, 'content_export', ${input.jobId},
      ${input.action}, ${input.idempotencyKey},
      ${transaction.json(input.metadata as postgres.JSONValue)}::jsonb
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
    do nothing
  `;
}
