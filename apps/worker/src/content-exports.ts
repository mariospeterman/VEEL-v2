import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

const tarBlockBytes = 512;
const maximumJobItems = 20_000;
const maximumArchiveSourceBytes = 100 * 1024 * 1024 * 1024;
const maximumManifestBytes = 16 * 1024 * 1024;
// A 12-byte ustar size field contains eleven octal digits plus NUL.
const maximumUstarFileBytes = 8_589_934_591;
const maximumRestoreArchiveBytes =
  maximumArchiveSourceBytes + maximumManifestBytes + ((maximumJobItems + 1) * tarBlockBytes * 2) + (tarBlockBytes * 2);
const maximumAttempts = 8;
const cancellationCheckIntervalBytes = 8 * 1024 * 1024;

/** Narrow worker-facing provider port; the API package adapter implements it structurally. */
export interface ContentExportProvider {
  openSource(input: {
    provider: "bunny" | "livepeer";
    providerObjectReference: string;
    assetKind: "image" | "video";
  }): Promise<
    | { state: "available"; byteLength: number; body: AsyncIterable<Uint8Array> }
    | { state: "unavailable"; reason: string }
  >;
  uploadArchive(input: {
    archiveObjectKey: string;
    body: AsyncIterable<Uint8Array>;
  }): Promise<void>;
}

export interface QueuedContentExportJob {
  jobId: string;
  dataRequestId: string;
  requesterUserId: string;
  archiveAttemptId: string;
  archiveAttemptSequence: string;
  archiveObjectKey: string;
  snapshotCreatedAt: Date;
  sourceHoldUntil: Date;
  leaseToken: string;
  attemptCount: number;
  totalItems: number;
}

export interface ContentExportSnapshotContent {
  contentItemId: string;
  compositionRevision: number;
  mediaType: string;
  contentState: string;
  publishState: string;
  visibility: string;
  nsfwLabel: string;
  moderationState: string;
  caption: string | null;
  bodyText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentExportSnapshotItem {
  contentItemId: string;
  mediaAssetId: string;
  compositionRevision: number;
  assetKind: "image" | "video";
  position: number | null;
  mimeType: string | null;
  widthPixels: number | null;
  heightPixels: number | null;
  durationMs: number | null;
  sourceChecksumSha256: string | null;
  retiredAt: Date | null;
  sourceProvider: "bunny" | "livepeer";
  sourceObjectReference: string;
  sourceRetentionClass: "provider_original" | "sanitized_retained_source";
  initialUnavailableReason: string | null;
}

export interface ContentExportSnapshot {
  contents: ContentExportSnapshotContent[];
  items: ContentExportSnapshotItem[];
}

export type ContentExportItemOutcome =
  | {
      state: "exported";
      archivePath: string;
      byteSize: number;
      sha256: string;
    }
  | {
      state: "unavailable";
      reason: string;
    };

export type ContentExportJobOutcome =
  | {
      state: "ready";
      archiveByteSize: number;
      archiveSha256: string;
      availableItems: number;
      unavailableItems: number;
    }
  | { state: "retry"; errorCode: string }
  | { state: "dead_letter"; errorCode: string }
  | { state: "cancelled" };

export interface ContentExportRepository {
  leaseDueExports(input: {
    now: Date;
    limit: number;
    leaseDurationMs: number;
  }): Promise<QueuedContentExportJob[]>;
  loadSnapshot(job: QueuedContentExportJob): Promise<ContentExportSnapshot>;
  findCurrentItemUnavailableReason(input: {
    job: QueuedContentExportJob;
    item: ContentExportSnapshotItem;
  }): Promise<string | null>;
  recordItemOutcome(input: {
    job: QueuedContentExportJob;
    mediaAssetId: string;
    now: Date;
    leaseDurationMs: number;
    outcome: ContentExportItemOutcome;
  }): Promise<void>;
  heartbeat(input: {
    job: QueuedContentExportJob;
    now: Date;
    leaseDurationMs: number;
  }): Promise<boolean>;
  isCancellationRequested(job: QueuedContentExportJob): Promise<boolean>;
  markArchiveUploadStarted(input: {
    job: QueuedContentExportJob;
    now: Date;
  }): Promise<boolean>;
  markArchiveUploadCompleted(input: {
    job: QueuedContentExportJob;
    now: Date;
    archiveByteSize: number;
    archiveSha256: string;
  }): Promise<boolean>;
  recordJobOutcome(input: {
    job: QueuedContentExportJob;
    now: Date;
    outcome: ContentExportJobOutcome;
  }): Promise<ContentExportJobOutcome | null>;
  quarantineExpiredArchives(input: { now: Date; limit: number }): Promise<number>;
  expireElapsedSourceHolds(input: { now: Date; limit: number }): Promise<number>;
  close?(): Promise<void>;
}

export interface ProcessContentExportsResult {
  leased: number;
  ready: number;
  retrying: number;
  deadLettered: number;
  cancelled: number;
  quarantined: number;
  sourceHoldsExpired: number;
}

export interface PostgresContentExportRepositoryOptions {
  databaseUrl?: string;
  sql?: postgres.Sql;
}

interface ContentExportManifestAsset {
  id: string;
  contentId: string;
  compositionRevision: number;
  kind: "image" | "video";
  position: number | null;
  mimeType: string | null;
  widthPixels: number | null;
  heightPixels: number | null;
  durationMs: number | null;
  retired: boolean;
  sourceLabel: "provider_original" | "sanitized_retained_source";
  availability: "exported" | "unavailable";
  archivePath: string | null;
  byteSize: number | null;
  sha256: string | null;
  unavailableReason: string | null;
}

interface ContentExportManifest {
  schemaVersion: 1;
  archiveFormat: "ustar";
  snapshotAt: string;
  privacyBoundary: "owned_content_minimized_no_messages_identity_payment_wallet_or_secrets";
  rightsBoundary: "export_does_not_change_retirement_takedown_retention_or_paid_access_obligations";
  contents: Array<{
    id: string;
    compositionRevision: number;
    mediaType: string;
    state: string;
    publishState: string;
    visibility: string;
    nsfwLabel: string;
    moderationState: string;
    caption: string | null;
    bodyText: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  assets: ContentExportManifestAsset[];
}

export async function processContentExports(input: {
  repository: ContentExportRepository;
  provider: ContentExportProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
}): Promise<ProcessContentExportsResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 5, 25));
  const leaseDurationMs = Math.max(60_000, Math.min(input.leaseDurationMs ?? 10 * 60 * 1000, 30 * 60 * 1000));
  const sourceHoldsExpired = await input.repository.expireElapsedSourceHolds({ now, limit });
  const quarantined = await input.repository.quarantineExpiredArchives({ now, limit });
  const jobs = await input.repository.leaseDueExports({ now, limit, leaseDurationMs });
  const result: ProcessContentExportsResult = {
    leased: jobs.length,
    ready: 0,
    retrying: 0,
    deadLettered: 0,
    cancelled: 0,
    quarantined,
    sourceHoldsExpired
  };

  for (const job of jobs) {
    const outcome = await processOneContentExport({
      repository: input.repository,
      provider: input.provider,
      job,
      now,
      leaseDurationMs
    }).catch((error): ContentExportJobOutcome => {
      if (error instanceof ContentExportCancelledError) return { state: "cancelled" };
      if (error instanceof ContentExportPermanentError) {
        return { state: "dead_letter", errorCode: error.errorCode };
      }
      return {
        state: job.attemptCount >= maximumAttempts ? "dead_letter" : "retry",
        errorCode: safeWorkerErrorCode(error)
      };
    });

    const acceptedOutcome = await input.repository.recordJobOutcome({
      job,
      now: new Date(),
      outcome
    });
    if (!acceptedOutcome) continue;
    if (acceptedOutcome.state === "ready") result.ready += 1;
    else if (acceptedOutcome.state === "retry") result.retrying += 1;
    else if (acceptedOutcome.state === "dead_letter") result.deadLettered += 1;
    else result.cancelled += 1;
  }

  return result;
}

async function processOneContentExport(input: {
  repository: ContentExportRepository;
  provider: ContentExportProvider;
  job: QueuedContentExportJob;
  now: Date;
  leaseDurationMs: number;
}): Promise<Extract<ContentExportJobOutcome, { state: "ready" }>> {
  if (input.job.totalItems > maximumJobItems) {
    throw new ContentExportPermanentError("export_inventory_limit_exceeded");
  }
  if (await input.repository.isCancellationRequested(input.job)) {
    throw new ContentExportCancelledError();
  }
  const snapshot = await input.repository.loadSnapshot(input.job);
  if (snapshot.items.length !== input.job.totalItems) {
    throw new ContentExportPermanentError("export_snapshot_inconsistent");
  }

  const archiveHash = createHash("sha256");
  let archiveByteSize = 0;
  let availableItems = 0;
  let unavailableItems = 0;
  const exportedItems: ContentExportSnapshotItem[] = [];
  const archiveBody = (async function* () {
    const assets: ContentExportManifestAsset[] = [];
    let sourceBytes = 0;
    for (const item of snapshot.items) {
      if (await input.repository.isCancellationRequested(input.job)) {
        throw new ContentExportCancelledError();
      }
      if (item.initialUnavailableReason) {
        const outcome = { state: "unavailable" as const, reason: item.initialUnavailableReason };
        await input.repository.recordItemOutcome({
          job: input.job,
          mediaAssetId: item.mediaAssetId,
          now: new Date(),
          leaseDurationMs: input.leaseDurationMs,
          outcome
        });
        unavailableItems += 1;
        assets.push(manifestUnavailableAsset(item, outcome.reason));
        continue;
      }

      // Snapshot ownership is immutable, but safety/takedown and provider-cleanup
      // state are live authorities. Reauthorize immediately before every provider
      // read so a post-request restriction cannot be bypassed by the export hold.
      const currentUnavailableReason = await input.repository.findCurrentItemUnavailableReason({
        job: input.job,
        item
      });
      if (currentUnavailableReason) {
        const outcome = { state: "unavailable" as const, reason: currentUnavailableReason };
        await input.repository.recordItemOutcome({
          job: input.job,
          mediaAssetId: item.mediaAssetId,
          now: new Date(),
          leaseDurationMs: input.leaseDurationMs,
          outcome
        });
        unavailableItems += 1;
        assets.push(manifestUnavailableAsset(item, currentUnavailableReason));
        continue;
      }

      const source = await input.provider.openSource({
        provider: item.sourceProvider,
        providerObjectReference: item.sourceObjectReference,
        assetKind: item.assetKind
      });
      if (source.state === "unavailable") {
        const outcome = { state: "unavailable" as const, reason: source.reason };
        await input.repository.recordItemOutcome({
          job: input.job,
          mediaAssetId: item.mediaAssetId,
          now: new Date(),
          leaseDurationMs: input.leaseDurationMs,
          outcome
        });
        unavailableItems += 1;
        assets.push(manifestUnavailableAsset(item, source.reason));
        continue;
      }
      if (source.byteLength > maximumUstarFileBytes) {
        const reason = "source_too_large_for_ustar";
        const outcome = { state: "unavailable" as const, reason };
        await input.repository.recordItemOutcome({
          job: input.job,
          mediaAssetId: item.mediaAssetId,
          now: new Date(),
          leaseDurationMs: input.leaseDurationMs,
          outcome
        });
        unavailableItems += 1;
        assets.push(manifestUnavailableAsset(item, reason));
        continue;
      }
      if (sourceBytes + source.byteLength > maximumArchiveSourceBytes) {
        const reason = "archive_source_budget_exceeded";
        const outcome = { state: "unavailable" as const, reason };
        await input.repository.recordItemOutcome({
          job: input.job,
          mediaAssetId: item.mediaAssetId,
          now: new Date(),
          leaseDurationMs: input.leaseDurationMs,
          outcome
        });
        unavailableItems += 1;
        assets.push(manifestUnavailableAsset(item, reason));
        continue;
      }
      sourceBytes += source.byteLength;

      const archivePath = archivePathFor(item);
      yield tarHeader(archivePath, source.byteLength, input.job.snapshotCreatedAt);
      const fileHash = createHash("sha256");
      let actualBytes = 0;
      let bytesSinceCancellationCheck = 0;
      for await (const sourceChunk of source.body) {
        const chunk = normalizedChunk(sourceChunk);
        actualBytes += chunk.byteLength;
        bytesSinceCancellationCheck += chunk.byteLength;
        if (actualBytes > source.byteLength) {
          throw new ContentExportPermanentError("export_source_length_mismatch");
        }
        fileHash.update(chunk);
        yield chunk;
        if (bytesSinceCancellationCheck >= cancellationCheckIntervalBytes) {
          bytesSinceCancellationCheck = 0;
          if (!await input.repository.heartbeat({
            job: input.job,
            now: new Date(),
            leaseDurationMs: input.leaseDurationMs
          }) || await input.repository.isCancellationRequested(input.job)) {
            throw new ContentExportCancelledError();
          }
          if (await input.repository.findCurrentItemUnavailableReason({ job: input.job, item })) {
            throw new ContentExportPermanentError("export_source_restricted_during_read");
          }
        }
      }
      if (actualBytes !== source.byteLength) {
        throw new ContentExportPermanentError("export_source_length_mismatch");
      }
      const sha256 = fileHash.digest("hex");
      if (item.sourceChecksumSha256 && item.sourceChecksumSha256 !== sha256) {
        throw new ContentExportPermanentError("export_source_checksum_mismatch");
      }
      const padding = tarPadding(actualBytes);
      if (padding.byteLength > 0) yield padding;
      const outcome = {
        state: "exported" as const,
        archivePath,
        byteSize: actualBytes,
        sha256
      };
      await input.repository.recordItemOutcome({
        job: input.job,
        mediaAssetId: item.mediaAssetId,
        now: new Date(),
        leaseDurationMs: input.leaseDurationMs,
        outcome
      });
      availableItems += 1;
      exportedItems.push(item);
      assets.push(manifestExportedAsset(item, outcome));
    }

    if (await input.repository.isCancellationRequested(input.job)) {
      throw new ContentExportCancelledError();
    }
    const manifest = manifestFor(input.job, snapshot.contents, assets);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (manifestBytes.byteLength > maximumManifestBytes) {
      throw new ContentExportPermanentError("export_manifest_size_limit_exceeded");
    }
    yield tarHeader("manifest.json", manifestBytes.byteLength, input.job.snapshotCreatedAt);
    yield manifestBytes;
    const manifestPadding = tarPadding(manifestBytes.byteLength);
    if (manifestPadding.byteLength > 0) yield manifestPadding;
    yield Buffer.alloc(tarBlockBytes * 2);
  })();

  const hashedArchive = (async function* () {
    for await (const chunk of archiveBody) {
      const normalized = normalizedChunk(chunk);
      archiveHash.update(normalized);
      archiveByteSize += normalized.byteLength;
      yield normalized;
    }
  })();

  if (!await input.repository.markArchiveUploadStarted({
    job: input.job,
    now: new Date()
  })) {
    throw new ContentExportCancelledError();
  }
  await input.provider.uploadArchive({
    archiveObjectKey: input.job.archiveObjectKey,
    body: hashedArchive
  });
  if (archiveByteSize <= tarBlockBytes * 2) {
    throw new ContentExportPermanentError("export_archive_invalid");
  }
  const archiveSha256 = archiveHash.digest("hex");
  if (!await input.repository.markArchiveUploadCompleted({
    job: input.job,
    now: new Date(),
    archiveByteSize,
    archiveSha256
  })) {
    throw new ContentExportCancelledError();
  }
  for (const item of exportedItems) {
    if (await input.repository.findCurrentItemUnavailableReason({ job: input.job, item })) {
      throw new ContentExportPermanentError("export_source_restricted_before_release");
    }
  }
  if (await input.repository.isCancellationRequested(input.job)) {
    // The private attempt object is intentionally not deleted automatically.
    // It is never linked as downloadable when cancellation wins this fence.
    throw new ContentExportCancelledError();
  }
  return {
    state: "ready",
    archiveByteSize,
    archiveSha256,
    availableItems,
    unavailableItems
  };
}

export function createPostgresContentExportRepository(
  databaseUrlOrOptions?: string | PostgresContentExportRepositoryOptions
): ContentExportRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string"
    ? databaseUrlOrOptions
    : databaseUrlOrOptions?.databaseUrl;
  const injectedSql = typeof databaseUrlOrOptions === "string"
    ? undefined
    : databaseUrlOrOptions?.sql;
  if (!databaseUrl && !injectedSql) {
    return {
      async leaseDueExports() { return []; },
      async loadSnapshot() { return { contents: [], items: [] }; },
      async findCurrentItemUnavailableReason() { return "export_source_not_authorized"; },
      async recordItemOutcome() {},
      async heartbeat() { return false; },
      async isCancellationRequested() { return true; },
      async markArchiveUploadStarted() { return false; },
      async markArchiveUploadCompleted() { return false; },
      async recordJobOutcome(input) { return input.outcome; },
      async quarantineExpiredArchives() { return 0; },
      async expireElapsedSourceHolds() { return 0; }
    };
  }

  const ownsSql = !injectedSql;
  const sql = injectedSql ?? postgres(databaseUrl!, { max: 4 });
  return {
    async leaseDueExports(input) {
      return sql.begin(async (transaction) => {
        const staleLeases = await transaction<Array<{
          id: string;
          data_request_id: string;
          requester_user_id: string;
          attempt_count: number;
          archive_attempt_sequence: string;
          cancel_requested_at: Date | null;
          lease_token: string;
        }>>`
          select id, data_request_id, requester_user_id, attempt_count,
            archive_attempt_sequence, cancel_requested_at, lease_token
          from content_export_jobs
          where state = 'processing'
            and leased_until <= ${input.now}
            and source_hold_until > ${input.now}
          order by leased_until, id
          for update skip locked
          limit ${input.limit}
        `;
        for (const stale of staleLeases) {
          // Locking and revalidating the job happens before touching its
          // provider attempt. A concurrent heartbeat either owns the row (so
          // SKIP LOCKED leaves both rows unchanged) or loses after this
          // transaction has atomically terminalized the lease.
          const terminalAttempts = await transaction<Array<{
            state: "abandoned" | "cleanup_required";
          }>>`
            update content_export_archive_attempts
            set state = case
                  when upload_started_at is null then 'abandoned'
                  else 'cleanup_required'
                end,
                updated_at = clock_timestamp()
            where job_id = ${stale.id}
              and lease_token = ${stale.lease_token}
              and state in ('allocated', 'uploading', 'uploaded')
            returning state
          `;
          const terminalAttemptState = terminalAttempts[0]?.state;
          if (!terminalAttemptState) {
            throw new Error(`Content export ${stale.id} has no active archive attempt for its expired lease`);
          }
          const cleanupRequiresConfirmation = terminalAttemptState === "cleanup_required";

          if (stale.cancel_requested_at) {
            await transaction`
              update content_export_jobs
              set state = 'cancelled', lease_token = null, leased_until = null,
                  next_attempt_at = null, updated_at = clock_timestamp()
              where id = ${stale.id}
                and state = 'processing'
                and lease_token = ${stale.lease_token}
                and leased_until <= ${input.now}
                and cancel_requested_at is not null
            `;
            await transaction`
              update data_requests
              set state = 'cancelled', reason = 'cancelled_by_requester',
                  updated_at = clock_timestamp(), completed_at = null
              where id = ${stale.data_request_id} and type = 'export'
            `;
            await insertWorkerAudit(transaction, {
              actorUserId: stale.requester_user_id,
              jobId: stale.id,
              action: "content_export_cancelled",
              idempotencyKey: `worker:content-export:${stale.id}:archive-attempt:${stale.archive_attempt_sequence}:stale-lease-cancelled`,
              metadata: {
                archiveAttemptSequence: stale.archive_attempt_sequence,
                archiveAttemptState: terminalAttemptState,
                cleanupRequiresConfirmation,
                recoveredFromExpiredLease: true
              }
            });
            continue;
          }

          if (Number(stale.attempt_count) >= maximumAttempts) {
            await transaction`
              update content_export_jobs
              set state = 'dead_letter', next_attempt_at = null,
                  lease_token = null, leased_until = null,
                  last_error_code = 'export_attempt_budget_exhausted',
                  updated_at = clock_timestamp()
              where id = ${stale.id}
                and state = 'processing'
                and lease_token = ${stale.lease_token}
                and leased_until <= ${input.now}
                and cancel_requested_at is null
                and attempt_count >= ${maximumAttempts}
            `;
            await transaction`
              update data_requests
              set state = 'failed', reason = 'export_attempt_budget_exhausted',
                  updated_at = clock_timestamp(), completed_at = null
              where id = ${stale.data_request_id} and type = 'export'
            `;
            await insertWorkerAudit(transaction, {
              actorUserId: stale.requester_user_id,
              jobId: stale.id,
              action: "content_export_attempt_budget_exhausted",
              idempotencyKey: `worker:content-export:${stale.id}:archive-attempt:${stale.archive_attempt_sequence}:attempt-budget-exhausted`,
              metadata: {
                attemptCount: Number(stale.attempt_count),
                archiveAttemptSequence: stale.archive_attempt_sequence,
                archiveAttemptState: terminalAttemptState,
                providerDeletionAutomated: false,
                cleanupRequiresConfirmation
              }
            });
            continue;
          }

          await transaction`
            update content_export_jobs
            set state = 'retry', next_attempt_at = ${input.now}, lease_token = null,
                leased_until = null, last_error_code = 'export_lease_expired',
                updated_at = clock_timestamp()
            where id = ${stale.id}
              and state = 'processing'
              and lease_token = ${stale.lease_token}
              and leased_until <= ${input.now}
              and cancel_requested_at is null
              and attempt_count < ${maximumAttempts}
          `;
        }
        const rows = await transaction<Array<{
          id: string;
          data_request_id: string;
          requester_user_id: string;
          snapshot_created_at: Date;
          source_hold_until: Date;
          attempt_count: number;
          progress_total_items: number;
        }>>`
          select id, data_request_id, requester_user_id,
            snapshot_created_at, source_hold_until, attempt_count, progress_total_items
          from content_export_jobs
          where state in ('queued', 'retry')
            and next_attempt_at <= ${input.now}
            and source_hold_until > ${input.now}
            and cancel_requested_at is null
            and attempt_count < ${maximumAttempts}
          order by next_attempt_at, created_at, id
          for update skip locked
          limit ${input.limit}
        `;
        const jobs: QueuedContentExportJob[] = [];
        for (const row of rows) {
          const leaseToken = randomUUID();
          const archiveAttemptId = randomUUID();
          const archiveObjectKey = `exports/${row.requester_user_id}/${randomUUID()}.tar`;
          const leased = await transaction<Array<{
            id: string;
            archive_attempt_sequence: string;
          }>>`
            update content_export_jobs
            set state = 'processing',
                attempt_count = attempt_count + 1,
                archive_attempt_sequence = archive_attempt_sequence + 1,
                next_attempt_at = null,
                lease_token = ${leaseToken},
                leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
                last_error_code = null,
                updated_at = clock_timestamp()
            where id = ${row.id}
              and state in ('queued', 'retry')
              and source_hold_until > ${input.now}
              and cancel_requested_at is null
            returning id, archive_attempt_sequence
          `;
          if (!leased[0]) continue;
          const archiveAttemptSequence = String(leased[0].archive_attempt_sequence);

          await transaction`
            insert into content_export_archive_attempts (
              id, job_id, attempt_sequence, attempt_count, lease_token, object_key, state
            ) values (
              ${archiveAttemptId}, ${row.id}, ${archiveAttemptSequence},
              ${Number(row.attempt_count) + 1},
              ${leaseToken}, ${archiveObjectKey}, 'allocated'
            )
          `;

          await transaction`
            update content_export_job_items
            set state = case when initial_unavailable_reason is null then 'pending' else 'unavailable' end,
                unavailable_reason = initial_unavailable_reason,
                archive_path = null,
                exported_byte_size = null,
                exported_sha256 = null,
                processed_at = case when initial_unavailable_reason is null then null else clock_timestamp() end
            where job_id = ${row.id}
          `;
          await transaction`
            update content_export_jobs job
            set progress_completed_items = inventory.unavailable_items,
                progress_available_items = 0,
                progress_unavailable_items = inventory.unavailable_items,
                updated_at = clock_timestamp()
            from (
              select count(*) filter (where initial_unavailable_reason is not null)::integer as unavailable_items
              from content_export_job_items
              where job_id = ${row.id}
            ) inventory
            where job.id = ${row.id}
          `;
          await transaction`
            update data_requests
            set state = 'processing', updated_at = clock_timestamp(), completed_at = null
            where id = ${row.data_request_id} and type = 'export'
          `;
          await insertWorkerAudit(transaction, {
            actorUserId: row.requester_user_id,
            jobId: row.id,
            action: "content_export_processing_started",
            idempotencyKey: `worker:content-export:${row.id}:archive-attempt:${archiveAttemptSequence}:started`,
            metadata: {
              archiveAttemptId,
              archiveAttemptSequence,
              attemptCount: Number(row.attempt_count) + 1
            }
          });
          jobs.push({
            jobId: row.id,
            dataRequestId: row.data_request_id,
            requesterUserId: row.requester_user_id,
            archiveAttemptId,
            archiveAttemptSequence,
            archiveObjectKey,
            snapshotCreatedAt: row.snapshot_created_at,
            sourceHoldUntil: row.source_hold_until,
            leaseToken,
            attemptCount: Number(row.attempt_count) + 1,
            totalItems: Number(row.progress_total_items)
          });
        }
        return jobs;
      });
    },

    async loadSnapshot(job) {
      const contents = await sql<Array<{
        content_item_id: string;
        composition_revision: number;
        media_type: string;
        content_state: string;
        publish_state: string;
        visibility: string;
        nsfw_label: string;
        moderation_state: string;
        caption: string | null;
        body_text: string | null;
        content_created_at: Date;
        content_updated_at: Date;
      }>>`
        select content_item_id, composition_revision, media_type, content_state,
          publish_state, visibility, nsfw_label, moderation_state, caption, body_text,
          content_created_at, content_updated_at
        from content_export_job_contents
        where job_id = ${job.jobId}
        order by content_created_at, content_item_id
      `;
      const items = await sql<Array<{
        content_item_id: string;
        media_asset_id: string;
        composition_revision: number;
        asset_kind: "image" | "video";
        position: number | null;
        mime_type: string | null;
        width_pixels: number | null;
        height_pixels: number | null;
        duration_ms: number | null;
        source_checksum_sha256: string | null;
        retired_at: Date | null;
        source_provider: "bunny" | "livepeer";
        source_object_reference: string;
        source_retention_class: "provider_original" | "sanitized_retained_source";
        initial_unavailable_reason: string | null;
      }>>`
        select content_item_id, media_asset_id, composition_revision, asset_kind,
          position, mime_type, width_pixels, height_pixels, duration_ms,
          source_checksum_sha256, retired_at, source_provider, source_object_reference,
          source_retention_class, initial_unavailable_reason
        from content_export_job_items
        where job_id = ${job.jobId}
        order by content_item_id, position nulls last, media_asset_id
      `;
      return {
        contents: contents.map((row) => ({
          contentItemId: row.content_item_id,
          compositionRevision: Number(row.composition_revision),
          mediaType: row.media_type,
          contentState: row.content_state,
          publishState: row.publish_state,
          visibility: row.visibility,
          nsfwLabel: row.nsfw_label,
          moderationState: row.moderation_state,
          caption: row.caption,
          bodyText: row.body_text,
          createdAt: row.content_created_at,
          updatedAt: row.content_updated_at
        })),
        items: items.map((row) => ({
          contentItemId: row.content_item_id,
          mediaAssetId: row.media_asset_id,
          compositionRevision: Number(row.composition_revision),
          assetKind: row.asset_kind,
          position: row.position === null ? null : Number(row.position),
          mimeType: row.mime_type,
          widthPixels: row.width_pixels === null ? null : Number(row.width_pixels),
          heightPixels: row.height_pixels === null ? null : Number(row.height_pixels),
          durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
          sourceChecksumSha256: row.source_checksum_sha256,
          retiredAt: row.retired_at,
          sourceProvider: row.source_provider,
          sourceObjectReference: row.source_object_reference,
          sourceRetentionClass: row.source_retention_class,
          initialUnavailableReason: row.initial_unavailable_reason
        }))
      };
    },

    async findCurrentItemUnavailableReason(input) {
      const rows = await sql<Array<{ unavailable_reason: string | null }>>`
        select case
          when job.source_hold_until <= clock_timestamp()
            then 'export_source_hold_expired'
          when content.creator_user_id is distinct from job.requester_user_id
            then 'export_source_not_authorized'
          when content.state::text in ('blocked', 'deleted')
            then 'content_restricted_by_safety_or_takedown'
          when asset.content_item_id is distinct from item.content_item_id
            then 'export_source_not_authorized'
          when asset.provider::text is distinct from item.source_provider
            or asset.provider_asset_id is distinct from item.source_object_reference
            then 'export_source_changed_after_snapshot'
          when asset.provider_cleanup_lease_token is not null
            then 'provider_cleanup_already_leased'
          when asset.provider_cleanup_state = 'completed'
            then 'provider_object_retired'
          else null
        end as unavailable_reason
        from content_export_jobs job
        join content_export_job_items item
          on item.job_id = job.id
          and item.media_asset_id = ${input.item.mediaAssetId}
        join content_items content on content.id = item.content_item_id
        join media_assets asset on asset.id = item.media_asset_id
        where job.id = ${input.job.jobId}
          and job.state = 'processing'
          and job.lease_token = ${input.job.leaseToken}
          and job.leased_until > clock_timestamp()
      `;
      return rows.length === 0
        ? "export_source_not_authorized"
        : rows[0]!.unavailable_reason;
    },

    async recordItemOutcome(input) {
      await sql.begin(async (transaction) => {
        const rows = input.outcome.state === "exported"
          ? await transaction<{ id: string }[]>`
              update content_export_job_items item
              set state = 'exported', unavailable_reason = null,
                  archive_path = ${input.outcome.archivePath},
                  exported_byte_size = ${input.outcome.byteSize},
                  exported_sha256 = ${input.outcome.sha256}, processed_at = ${input.now}
              from content_export_jobs job
              where item.job_id = ${input.job.jobId}
                and item.media_asset_id = ${input.mediaAssetId}
                and job.id = item.job_id
                and job.state = 'processing'
                and job.lease_token = ${input.job.leaseToken}
                and job.leased_until > clock_timestamp()
                and job.source_hold_until > clock_timestamp()
              returning item.media_asset_id as id
            `
          : await transaction<{ id: string }[]>`
              update content_export_job_items item
              set state = 'unavailable', unavailable_reason = ${input.outcome.reason},
                  archive_path = null, exported_byte_size = null, exported_sha256 = null,
                  processed_at = ${input.now}
              from content_export_jobs job
              where item.job_id = ${input.job.jobId}
                and item.media_asset_id = ${input.mediaAssetId}
                and job.id = item.job_id
                and job.state = 'processing'
                and job.lease_token = ${input.job.leaseToken}
                and job.leased_until > clock_timestamp()
                and job.source_hold_until > clock_timestamp()
              returning item.media_asset_id as id
            `;
        if (!rows[0]) throw new ContentExportCancelledError();
        await transaction`
          update content_export_jobs job
          set progress_completed_items = inventory.completed,
              progress_available_items = inventory.available,
              progress_unavailable_items = inventory.unavailable,
              leased_until = least(
                ${new Date(input.now.getTime() + input.leaseDurationMs)},
                job.source_hold_until
              ),
              updated_at = clock_timestamp()
          from (
            select count(*) filter (where state <> 'pending')::integer as completed,
              count(*) filter (where state = 'exported')::integer as available,
              count(*) filter (where state = 'unavailable')::integer as unavailable
            from content_export_job_items
            where job_id = ${input.job.jobId}
          ) inventory
          where job.id = ${input.job.jobId}
            and job.state = 'processing'
            and job.lease_token = ${input.job.leaseToken}
            and job.source_hold_until > clock_timestamp()
        `;
      });
    },

    async heartbeat(input) {
      const rows = await sql<{ id: string }[]>`
        update content_export_jobs
        set leased_until = least(
              ${new Date(input.now.getTime() + input.leaseDurationMs)},
              source_hold_until
            ),
            updated_at = clock_timestamp()
        where id = ${input.job.jobId}
          and state = 'processing'
          and lease_token = ${input.job.leaseToken}
          and leased_until > ${input.now}
          and source_hold_until > clock_timestamp()
          and cancel_requested_at is null
        returning id
      `;
      return Boolean(rows[0]);
    },

    async isCancellationRequested(job) {
      const rows = await sql<{ cancelled: boolean }[]>`
        select (
          state <> 'processing'
          or lease_token is distinct from ${job.leaseToken}::uuid
          or leased_until <= clock_timestamp()
          or source_hold_until <= clock_timestamp()
          or cancel_requested_at is not null
        ) as cancelled
        from content_export_jobs
        where id = ${job.jobId}
      `;
      return rows[0]?.cancelled ?? true;
    },

    async markArchiveUploadStarted(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<Array<{ requester_user_id: string }>>`
          update content_export_jobs
          set cleanup_state = 'manual_confirmation_required',
              archive_upload_started_at = coalesce(archive_upload_started_at, ${input.now}),
              updated_at = clock_timestamp()
          where id = ${input.job.jobId}
            and state = 'processing'
            and lease_token = ${input.job.leaseToken}
            and leased_until > ${input.now}
            and source_hold_until > clock_timestamp()
            and cancel_requested_at is null
          returning requester_user_id
        `;
        const row = rows[0];
        if (!row) return false;
        const attempts = await transaction<{ id: string }[]>`
          update content_export_archive_attempts
          set state = 'uploading', upload_started_at = ${input.now},
              updated_at = clock_timestamp()
          where id = ${input.job.archiveAttemptId}
            and job_id = ${input.job.jobId}
            and lease_token = ${input.job.leaseToken}
            and state = 'allocated'
          returning id
        `;
        if (!attempts[0]) throw new ContentExportCancelledError();
        await insertWorkerAudit(transaction, {
          actorUserId: row.requester_user_id,
          jobId: input.job.jobId,
          action: "content_export_archive_upload_started",
          idempotencyKey: `worker:content-export:${input.job.jobId}:archive-attempt:${input.job.archiveAttemptSequence}:archive-upload-started`,
          metadata: {
            archiveAttemptId: input.job.archiveAttemptId,
            archiveAttemptSequence: input.job.archiveAttemptSequence,
            attemptCount: input.job.attemptCount,
            cleanupState: "manual_confirmation_required"
          }
        });
        return true;
      });
    },

    async markArchiveUploadCompleted(input) {
      const rows = await sql<{ id: string }[]>`
        update content_export_archive_attempts attempt
        set state = 'uploaded', upload_completed_at = ${input.now},
            archive_byte_size = ${input.archiveByteSize},
            archive_sha256 = ${input.archiveSha256},
            updated_at = clock_timestamp()
        from content_export_jobs job
        where attempt.id = ${input.job.archiveAttemptId}
          and attempt.job_id = ${input.job.jobId}
          and attempt.lease_token = ${input.job.leaseToken}
          and attempt.state = 'uploading'
          and job.id = attempt.job_id
          and job.state = 'processing'
          and job.lease_token = ${input.job.leaseToken}
          and job.leased_until > ${input.now}
          and job.source_hold_until > clock_timestamp()
          and job.cancel_requested_at is null
        returning attempt.id
      `;
      return Boolean(rows[0]);
    },

    async recordJobOutcome(input) {
      return sql.begin(async (transaction) => {
        const jobRows = await transaction<{
          requester_user_id: string;
          data_request_id: string;
          cancel_requested_at: Date | null;
        }[]>`
          select requester_user_id, data_request_id, cancel_requested_at
          from content_export_jobs
          where id = ${input.job.jobId}
            and state = 'processing'
            and lease_token = ${input.job.leaseToken}
            and leased_until > ${input.now}
            and source_hold_until > clock_timestamp()
          for update
        `;
        const current = jobRows[0];
        if (!current) return null;

        let outcome: ContentExportJobOutcome = contentExportOutcomeAfterCancellationFence(
          input.outcome,
          current.cancel_requested_at !== null
        );
        if (outcome.state === "ready") {
          // Keep the final publication fence in the same transaction as the
          // winner pointer. The job row is already locked above; canonical
          // content writers lock content before media, so retain that order
          // before touching the archive-attempt row below.
          const releaseRestriction = await findLockedContentExportReleaseRestriction(
            transaction,
            {
              jobId: input.job.jobId,
              requesterUserId: current.requester_user_id
            }
          );
          if (releaseRestriction) {
            outcome = {
              state: "dead_letter",
              errorCode: "export_source_restricted_before_release"
            };
          }
        }
        const retrying = outcome.state === "retry";
        const nextAttemptAt = retrying
          ? new Date(input.now.getTime() + retryDelayMs(input.job.attemptCount))
          : null;
        const availableUntil = outcome.state === "ready"
          ? new Date(input.now.getTime() + 24 * 60 * 60 * 1000)
          : null;
        const attemptRows = outcome.state === "ready"
          ? await transaction<{ id: string }[]>`
              update content_export_archive_attempts
              set state = 'published', published_at = ${input.now},
                  updated_at = clock_timestamp()
              where id = ${input.job.archiveAttemptId}
                and job_id = ${input.job.jobId}
                and lease_token = ${input.job.leaseToken}
                and state = 'uploaded'
                and archive_byte_size = ${outcome.archiveByteSize}
                and archive_sha256 = ${outcome.archiveSha256}
              returning id
            `
          : await transaction<{ id: string }[]>`
              update content_export_archive_attempts
              set state = case
                    when upload_started_at is null then 'abandoned'
                    else 'cleanup_required'
                  end,
                  updated_at = clock_timestamp()
              where id = ${input.job.archiveAttemptId}
                and job_id = ${input.job.jobId}
                and lease_token = ${input.job.leaseToken}
                and state in ('allocated', 'uploading', 'uploaded')
              returning id
            `;
        if (!attemptRows[0]) return null;
        await transaction`
          update content_export_jobs
          set state = ${outcome.state},
              next_attempt_at = ${nextAttemptAt},
              lease_token = null,
              leased_until = null,
              last_error_code = ${
                outcome.state === "retry" || outcome.state === "dead_letter"
                  ? outcome.errorCode
                  : null
              },
              archive_object_key = case
                when ${outcome.state === "ready"} then ${input.job.archiveObjectKey}
                else archive_object_key
              end,
              archive_byte_size = ${outcome.state === "ready" ? outcome.archiveByteSize : null},
              archive_sha256 = ${outcome.state === "ready" ? outcome.archiveSha256 : null},
              archive_ready_at = ${outcome.state === "ready" ? input.now : null},
              downloadable_until = ${availableUntil},
              cleanup_state = case
                when ${outcome.state === "ready"} then 'retained_private'
                when cleanup_state = 'manual_confirmation_required' then cleanup_state
                else 'not_ready'
              end,
              progress_completed_items = case
                when ${outcome.state === "ready"} then progress_total_items
                else progress_completed_items
              end,
              progress_available_items = case
                when ${outcome.state === "ready"} then ${outcome.state === "ready" ? outcome.availableItems : 0}
                else progress_available_items
              end,
              progress_unavailable_items = case
                when ${outcome.state === "ready"} then ${outcome.state === "ready" ? outcome.unavailableItems : 0}
                else progress_unavailable_items
              end,
              updated_at = clock_timestamp()
          where id = ${input.job.jobId}
            and state = 'processing'
            and lease_token = ${input.job.leaseToken}
        `;
        const requestState = outcome.state === "ready"
          ? "completed"
          : outcome.state === "cancelled"
            ? "cancelled"
            : outcome.state === "dead_letter"
              ? "failed"
              : "processing";
        await transaction`
          update data_requests
          set state = ${requestState},
              reason = case
                when ${outcome.state === "dead_letter"}
                then ${outcome.state === "dead_letter" ? outcome.errorCode : null}
                when ${outcome.state === "cancelled"} then 'cancelled_by_requester'
                else reason
              end,
              updated_at = clock_timestamp(),
              completed_at = case when ${outcome.state === "ready"} then ${input.now} else null end
          where id = ${current.data_request_id} and type = 'export'
        `;
        const action = outcome.state === "ready"
          ? "content_export_ready"
          : outcome.state === "retry"
            ? "content_export_retry_scheduled"
            : outcome.state === "dead_letter"
              ? "content_export_dead_letter"
              : "content_export_cancelled";
        await insertWorkerAudit(transaction, {
          actorUserId: current.requester_user_id,
          jobId: input.job.jobId,
          action,
          idempotencyKey: `worker:content-export:${input.job.jobId}:archive-attempt:${input.job.archiveAttemptSequence}:${action}`,
          metadata: {
            archiveAttemptId: input.job.archiveAttemptId,
            archiveAttemptSequence: input.job.archiveAttemptSequence,
            attemptCount: input.job.attemptCount,
            errorCode: outcome.state === "retry" || outcome.state === "dead_letter"
              ? outcome.errorCode
              : null,
            availableItems: outcome.state === "ready" ? outcome.availableItems : null,
            unavailableItems: outcome.state === "ready" ? outcome.unavailableItems : null
          }
        });
        return outcome;
      });
    },

    async quarantineExpiredArchives(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<Array<{ id: string; requester_user_id: string }>>`
          select id, requester_user_id
          from content_export_jobs
          where state = 'ready'
            and cleanup_state = 'retained_private'
            and downloadable_until <= ${input.now}
          order by downloadable_until, id
          for update skip locked
          limit ${input.limit}
        `;
        for (const row of rows) {
          await transaction`
            update content_export_jobs
            set state = 'expired', cleanup_state = 'manual_confirmation_required',
                updated_at = clock_timestamp()
            where id = ${row.id}
              and state = 'ready'
              and cleanup_state = 'retained_private'
          `;
          await transaction`
            update content_export_download_grants
            set expires_at = least(expires_at, ${input.now})
            where job_id = ${row.id} and expires_at > ${input.now}
          `;
          await insertWorkerAudit(transaction, {
            actorUserId: row.requester_user_id,
            jobId: row.id,
            action: "content_export_archive_quarantined",
            idempotencyKey: `worker:content-export:${row.id}:archive-quarantined`,
            metadata: { providerDeletionAutomated: false, manualConfirmationRequired: true }
          });
        }
        return rows.length;
      });
    },

    async expireElapsedSourceHolds(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<Array<{
          id: string;
          data_request_id: string;
          requester_user_id: string;
          cancel_requested_at: Date | null;
          state: "queued" | "retry" | "processing";
          lease_token: string | null;
          source_hold_until: Date;
        }>>`
          select id, data_request_id, requester_user_id, cancel_requested_at,
            state, lease_token, source_hold_until
          from content_export_jobs
          where (
              state in ('queued', 'retry')
              or (state = 'processing' and leased_until <= ${input.now})
            )
            and source_hold_until <= ${input.now}
          order by source_hold_until, id
          for update skip locked
          limit ${input.limit}
        `;
        for (const row of rows) {
          const cancelled = row.cancel_requested_at !== null;
          const jobState = cancelled ? "cancelled" : "dead_letter";
          const requestState = cancelled ? "cancelled" : "failed";
          const requestReason = cancelled ? "cancelled_by_requester" : "export_source_hold_expired";
          const action = cancelled ? "content_export_cancelled" : "content_export_source_hold_expired";
          const auditSuffix = cancelled ? "source-hold-cancelled" : "source-hold-expired";
          if (row.state === "processing" && row.lease_token) {
            await transaction`
              update content_export_archive_attempts
              set state = case
                    when upload_started_at is null then 'abandoned'
                    else 'cleanup_required'
                  end,
                  updated_at = clock_timestamp()
              where job_id = ${row.id}
                and lease_token = ${row.lease_token}
                and state in ('allocated', 'uploading', 'uploaded')
            `;
          }
          await transaction`
            update content_export_jobs
            set state = ${jobState}, next_attempt_at = null,
                lease_token = null, leased_until = null,
                last_error_code = ${cancelled ? null : "export_source_hold_expired"},
                updated_at = clock_timestamp()
            where id = ${row.id}
              and (
                state in ('queued', 'retry')
                or (state = 'processing' and leased_until <= ${input.now})
              )
              and source_hold_until <= ${input.now}
          `;
          await transaction`
            update data_requests
            set state = ${requestState}, reason = ${requestReason},
                updated_at = clock_timestamp(), completed_at = null
            where id = ${row.data_request_id} and type = 'export'
          `;
          await insertWorkerAudit(transaction, {
            actorUserId: row.requester_user_id,
            jobId: row.id,
            action,
            idempotencyKey: `worker:content-export:${row.id}:source-hold:${row.source_hold_until.toISOString()}:${auditSuffix}`,
            metadata: {
              providerDeletionMayResume: true,
              cancellationRequested: cancelled,
              recoveredFromExpiredLease: true
            }
          });
        }
        return rows.length;
      });
    },

    async close() {
      if (ownsSql) await sql.end({ timeout: 5 });
    }
  };
}

async function findLockedContentExportReleaseRestriction(
  transaction: postgres.TransactionSql,
  input: { jobId: string; requesterUserId: string }
): Promise<string | null> {
  const contents = await transaction<Array<{ unavailable_reason: string | null }>>`
    select case
      when content.creator_user_id is distinct from ${input.requesterUserId}::uuid
        then 'export_source_not_authorized'
      when content.state::text in ('blocked', 'deleted')
        then 'content_restricted_by_safety_or_takedown'
      else null
    end as unavailable_reason
    from content_export_job_contents snapshot
    join content_items content on content.id = snapshot.content_item_id
    where snapshot.job_id = ${input.jobId}
    order by snapshot.content_item_id
    for update of content
  `;

  // Only exported media bytes can become a downloadable source. Initial or
  // live unavailable items stay manifest-only and need no provider-object
  // fence. Lock assets after their content rows to match composer writers.
  const assets = await transaction<Array<{ unavailable_reason: string | null }>>`
    select case
      when asset.content_item_id is distinct from item.content_item_id
        then 'export_source_not_authorized'
      when asset.provider::text is distinct from item.source_provider
        or asset.provider_asset_id is distinct from item.source_object_reference
        then 'export_source_changed_after_snapshot'
      when asset.provider_cleanup_lease_token is not null
        then 'provider_cleanup_already_leased'
      when asset.provider_cleanup_state = 'completed'
        then 'provider_object_retired'
      else null
    end as unavailable_reason
    from content_export_job_items item
    join media_assets asset on asset.id = item.media_asset_id
    where item.job_id = ${input.jobId}
      and item.state = 'exported'
    order by item.content_item_id, item.media_asset_id
    for update of asset
  `;

  return contents.find((row) => row.unavailable_reason)?.unavailable_reason
    ?? assets.find((row) => row.unavailable_reason)?.unavailable_reason
    ?? null;
}

async function insertWorkerAudit(
  transaction: postgres.TransactionSql,
  input: {
    actorUserId: string;
    jobId: string;
    action: string;
    idempotencyKey: string;
    metadata: postgres.JSONValue;
  }
): Promise<void> {
  await transaction`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
    ) values (
      ${randomUUID()}, ${input.actorUserId}, 'content_export', ${input.jobId},
      ${input.action}, ${input.idempotencyKey}, ${transaction.json(input.metadata)}::jsonb
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
    do nothing
  `;
}

function manifestFor(
  job: QueuedContentExportJob,
  contents: ContentExportSnapshotContent[],
  assets: ContentExportManifestAsset[]
): ContentExportManifest {
  return {
    schemaVersion: 1,
    archiveFormat: "ustar",
    snapshotAt: job.snapshotCreatedAt.toISOString(),
    privacyBoundary: "owned_content_minimized_no_messages_identity_payment_wallet_or_secrets",
    rightsBoundary: "export_does_not_change_retirement_takedown_retention_or_paid_access_obligations",
    contents: contents.map((content) => ({
      id: content.contentItemId,
      compositionRevision: content.compositionRevision,
      mediaType: content.mediaType,
      state: content.contentState,
      publishState: content.publishState,
      visibility: content.visibility,
      nsfwLabel: content.nsfwLabel,
      moderationState: content.moderationState,
      caption: content.caption,
      bodyText: content.bodyText,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString()
    })),
    assets
  };
}

function manifestUnavailableAsset(
  item: ContentExportSnapshotItem,
  reason: string
): ContentExportManifestAsset {
  return {
    ...manifestAssetBase(item),
    availability: "unavailable",
    archivePath: null,
    byteSize: null,
    sha256: null,
    unavailableReason: reason
  };
}

function manifestExportedAsset(
  item: ContentExportSnapshotItem,
  outcome: Extract<ContentExportItemOutcome, { state: "exported" }>
): ContentExportManifestAsset {
  return {
    ...manifestAssetBase(item),
    availability: "exported",
    archivePath: outcome.archivePath,
    byteSize: outcome.byteSize,
    sha256: outcome.sha256,
    unavailableReason: null
  };
}

function manifestAssetBase(item: ContentExportSnapshotItem) {
  return {
    id: item.mediaAssetId,
    contentId: item.contentItemId,
    compositionRevision: item.compositionRevision,
    kind: item.assetKind,
    position: item.position,
    mimeType: item.mimeType,
    widthPixels: item.widthPixels,
    heightPixels: item.heightPixels,
    durationMs: item.durationMs,
    retired: item.retiredAt !== null,
    sourceLabel: item.sourceRetentionClass
  };
}

function archivePathFor(item: ContentExportSnapshotItem): string {
  return `content/${item.contentItemId}/assets/${item.mediaAssetId}.${extensionFor(item)}`;
}

function extensionFor(item: ContentExportSnapshotItem): string {
  if (item.mimeType === "image/jpeg") return "jpg";
  if (item.mimeType === "image/png") return "png";
  if (item.mimeType === "image/webp") return "webp";
  if (item.mimeType === "video/mp4") return "mp4";
  if (item.mimeType === "video/quicktime") return "mov";
  if (item.mimeType === "video/webm") return "webm";
  return "bin";
}

function tarHeader(path: string, byteLength: number, modifiedAt: Date): Buffer {
  const pathBytes = Buffer.from(path, "utf8");
  if (pathBytes.byteLength === 0 || pathBytes.byteLength > 100 || path.startsWith("/") || path.includes("..")) {
    throw new ContentExportPermanentError("export_archive_path_invalid");
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new ContentExportPermanentError("export_source_length_invalid");
  }
  const header = Buffer.alloc(tarBlockBytes);
  pathBytes.copy(header, 0);
  writeTarOctal(header, 100, 8, 0o600);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, byteLength);
  writeTarOctal(header, 136, 12, Math.floor(modifiedAt.getTime() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  header.write("wevid", 265, "ascii");
  header.write("wevid", 297, "ascii");
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeTarChecksum(header, checksum);
  return header;
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new ContentExportPermanentError("export_tar_numeric_overflow");
  buffer.write(encoded, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function writeTarChecksum(buffer: Buffer, checksum: number): void {
  const encoded = checksum.toString(8).padStart(6, "0");
  buffer.write(encoded, 148, 6, "ascii");
  buffer[154] = 0;
  buffer[155] = 0x20;
}

function tarPadding(byteLength: number): Buffer {
  const remainder = byteLength % tarBlockBytes;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(tarBlockBytes - remainder);
}

function normalizedChunk(chunk: Uint8Array): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 6));
}

export function contentExportOutcomeAfterCancellationFence(
  outcome: ContentExportJobOutcome,
  cancelRequested: boolean
): ContentExportJobOutcome {
  return cancelRequested ? { state: "cancelled" } : outcome;
}

function safeWorkerErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "ContentExportProviderConfigurationError") {
    return "export_provider_not_configured";
  }
  if (error instanceof Error && error.name === "ContentExportProviderTransientError") {
    return "export_provider_unavailable";
  }
  return "export_processing_failed";
}

class ContentExportCancelledError extends Error {
  constructor() {
    super("CONTENT_EXPORT_CANCELLED");
    this.name = "ContentExportCancelledError";
  }
}

class ContentExportPermanentError extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
    this.name = "ContentExportPermanentError";
  }
}

export interface ContentExportRestoreSink {
  beginFile(input: { path: string; byteLength: number }): Promise<void> | void;
  write(chunk: Uint8Array): Promise<void> | void;
  endFile(input: { path: string; byteLength: number; sha256: string }): Promise<void> | void;
}

export interface ContentExportRestoreResult {
  files: Array<{ path: string; byteLength: number; sha256: string }>;
  manifest: ContentExportManifest;
}

/**
 * Independent, streaming restore proof for local/test sinks. This deliberately
 * has no Bunny write, publication, moderation, or production restore adapter.
 */
export async function restoreContentExportTar(input: {
  archive: AsyncIterable<Uint8Array>;
  sink: ContentExportRestoreSink;
  expectedArchiveSha256: string;
}): Promise<ContentExportRestoreResult> {
  if (!/^[0-9a-f]{64}$/.test(input.expectedArchiveSha256)) {
    throw new Error("CONTENT_EXPORT_RESTORE_EXPECTED_HASH_INVALID");
  }
  const archiveHash = createHash("sha256");
  let archiveBytes = 0;
  const boundedArchive = (async function* () {
    for await (const sourceChunk of input.archive) {
      const chunk = normalizedChunk(sourceChunk);
      archiveBytes += chunk.byteLength;
      if (archiveBytes > maximumRestoreArchiveBytes) {
        throw new Error("CONTENT_EXPORT_RESTORE_ARCHIVE_TOO_LARGE");
      }
      archiveHash.update(chunk);
      yield chunk;
    }
  })();
  const reader = new AsyncByteReader(boundedArchive);
  const files: Array<{ path: string; byteLength: number; sha256: string }> = [];
  const seenPaths = new Set<string>();
  let zeroBlocks = 0;
  const manifestBytes: Buffer[] = [];
  let manifestByteLength = 0;
  let restoredPayloadBytes = 0;

  while (zeroBlocks < 2) {
    const header = await reader.readExactly(tarBlockBytes);
    if (header.every((value) => value === 0)) {
      zeroBlocks += 1;
      continue;
    }
    zeroBlocks = 0;
    verifyTarHeader(header);
    const path = readTarString(header, 0, 100);
    assertRestorePath(path);
    if (seenPaths.has(path)) throw new Error("CONTENT_EXPORT_RESTORE_DUPLICATE_PATH");
    seenPaths.add(path);
    if (seenPaths.size > maximumJobItems + 1) {
      throw new Error("CONTENT_EXPORT_RESTORE_ENTRY_LIMIT_EXCEEDED");
    }
    const byteLength = readTarOctal(header, 124, 12);
    if (path === "manifest.json") {
      if (byteLength > maximumManifestBytes) throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_TOO_LARGE");
    } else if (byteLength > maximumUstarFileBytes) {
      throw new Error("CONTENT_EXPORT_RESTORE_FILE_TOO_LARGE");
    }
    restoredPayloadBytes += byteLength;
    if (restoredPayloadBytes > maximumArchiveSourceBytes + maximumManifestBytes) {
      throw new Error("CONTENT_EXPORT_RESTORE_PAYLOAD_TOO_LARGE");
    }
    const hash = createHash("sha256");
    await input.sink.beginFile({ path, byteLength });
    let remaining = byteLength;
    while (remaining > 0) {
      const chunk = await reader.readAtMost(Math.min(remaining, 1024 * 1024));
      if (chunk.byteLength === 0) throw new Error("CONTENT_EXPORT_RESTORE_TRUNCATED");
      remaining -= chunk.byteLength;
      hash.update(chunk);
      if (path === "manifest.json") {
        manifestByteLength += chunk.byteLength;
        if (manifestByteLength > maximumManifestBytes) throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_TOO_LARGE");
        manifestBytes.push(Buffer.from(chunk));
      }
      await input.sink.write(chunk);
    }
    const padding = (tarBlockBytes - (byteLength % tarBlockBytes)) % tarBlockBytes;
    if (padding > 0) {
      const paddingBytes = await reader.readExactly(padding);
      if (!paddingBytes.every((value) => value === 0)) {
        throw new Error("CONTENT_EXPORT_RESTORE_PADDING_INVALID");
      }
    }
    const sha256 = hash.digest("hex");
    const file = { path, byteLength, sha256 };
    files.push(file);
    await input.sink.endFile(file);
  }

  if ((await reader.readAtMost(1)).byteLength !== 0) {
    throw new Error("CONTENT_EXPORT_RESTORE_TRAILING_DATA");
  }
  if (archiveHash.digest("hex") !== input.expectedArchiveSha256) {
    throw new Error("CONTENT_EXPORT_RESTORE_ARCHIVE_HASH_MISMATCH");
  }

  const manifestFiles = files.filter((file) => file.path === "manifest.json");
  const manifestFile = manifestFiles[0];
  if (!manifestFile) throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_MISSING");
  if (manifestFiles.length !== 1) throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_INVALID");
  let manifest: ContentExportManifest;
  try {
    manifest = JSON.parse(Buffer.concat(manifestBytes).toString("utf8")) as ContentExportManifest;
  } catch {
    throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_INVALID");
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.archiveFormat !== "ustar" ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > maximumJobItems ||
    !Array.isArray(manifest.contents)
  ) {
    throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_INVALID");
  }
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const expectedPaths = new Set(["manifest.json"]);
  for (const asset of manifest.assets) {
    if (asset.availability === "unavailable") {
      if (asset.archivePath !== null || asset.byteSize !== null || asset.sha256 !== null) {
        throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_INVALID");
      }
      continue;
    }
    if (
      asset.availability !== "exported" ||
      typeof asset.archivePath !== "string" ||
      asset.archivePath === "manifest.json" ||
      !Number.isSafeInteger(asset.byteSize) ||
      (asset.byteSize ?? -1) < 0 ||
      typeof asset.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      expectedPaths.has(asset.archivePath)
    ) {
      throw new Error("CONTENT_EXPORT_RESTORE_MANIFEST_INVALID");
    }
    expectedPaths.add(asset.archivePath);
    const restored = filesByPath.get(asset.archivePath);
    if (!restored || restored.byteLength !== asset.byteSize || restored.sha256 !== asset.sha256) {
      throw new Error("CONTENT_EXPORT_RESTORE_HASH_MISMATCH");
    }
  }
  if (
    files.length !== expectedPaths.size ||
    files.some((file) => !expectedPaths.has(file.path))
  ) {
    throw new Error("CONTENT_EXPORT_RESTORE_UNEXPECTED_FILE");
  }
  return { files, manifest };
}

class AsyncByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffered = Buffer.alloc(0);
  private ended = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  async readExactly(byteLength: number): Promise<Buffer> {
    const value = await this.readAtMost(byteLength, true);
    if (value.byteLength !== byteLength) throw new Error("CONTENT_EXPORT_RESTORE_TRUNCATED");
    return value;
  }

  async readAtMost(byteLength: number, exact = false): Promise<Buffer> {
    while (!this.ended && this.buffered.byteLength < byteLength) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      this.buffered = this.buffered.byteLength === 0
        ? chunk
        : Buffer.concat([this.buffered, chunk]);
      if (!exact && this.buffered.byteLength > 0) break;
    }
    const take = Math.min(byteLength, this.buffered.byteLength);
    const value = this.buffered.subarray(0, take);
    this.buffered = this.buffered.subarray(take);
    return value;
  }
}

function verifyTarHeader(header: Buffer): void {
  const expected = readTarOctal(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, value) => sum + value, 0);
  if (expected !== actual) throw new Error("CONTENT_EXPORT_RESTORE_HEADER_CHECKSUM_INVALID");
  if (
    readTarString(header, 257, 6) !== "ustar" ||
    (header[156] !== 0 && header[156] !== 0x30)
  ) {
    throw new Error("CONTENT_EXPORT_RESTORE_HEADER_INVALID");
  }
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  const field = buffer.subarray(offset, offset + length);
  const nullIndex = field.indexOf(0);
  return field.subarray(0, nullIndex === -1 ? field.length : nullIndex).toString("utf8");
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = readTarString(buffer, offset, length).trim();
  if (!/^[0-7]+$/.test(raw)) throw new Error("CONTENT_EXPORT_RESTORE_HEADER_INVALID");
  const parsed = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("CONTENT_EXPORT_RESTORE_HEADER_INVALID");
  return parsed;
}

function assertRestorePath(path: string): void {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("CONTENT_EXPORT_RESTORE_PATH_INVALID");
  }
}
