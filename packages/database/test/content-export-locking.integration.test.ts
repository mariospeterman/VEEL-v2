import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPostgresContentExportRepository as createApiContentExportRepository
} from "../../../apps/api/src/modules/content-export/content-export-repository.js";
import { createPrivacyRepository } from
  "../../../apps/api/src/modules/admin/admin-repository-privacy.js";
import {
  createPostgresContentExportRepository,
  processContentExports,
  type ContentExportProvider,
  type ContentExportRepository
} from "../../../apps/worker/src/content-exports.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_ROLLBACK_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("content export snapshot locking against migrated Postgres", () => {
  let setupSql: postgres.Sql | undefined;
  let writerSql: postgres.Sql | undefined;
  let snapshotSql: postgres.Sql | undefined;

  beforeAll(() => {
    const databaseUrl = process.env.ROLLBACK_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error("ROLLBACK_INTEGRATION_DATABASE_URL is required");
    const host = new URL(databaseUrl).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("Content export locking tests require an isolated loopback database");
    }
    setupSql = postgres(databaseUrl, { max: 1, prepare: false });
    writerSql = postgres(databaseUrl, { max: 1, prepare: false });
    snapshotSql = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await Promise.all([
      setupSql?.end({ timeout: 5 }),
      writerSql?.end({ timeout: 5 }),
      snapshotSql?.end({ timeout: 5 })
    ]);
  });

  it("waits for content-first composition writes before pinning metadata and assets", async () => {
    if (!setupSql || !writerSql || !snapshotSql) {
      throw new Error("Content export locking database was not initialized");
    }
    const userId = randomUUID();
    const contentId = randomUUID();
    const firstAssetId = randomUUID();
    const secondAssetId = randomUUID();
    const dataRequestId = randomUUID();
    let releaseWriter = () => {};
    let markWriterReady = () => {};
    const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writerReady = new Promise<void>((resolve) => { markWriterReady = resolve; });
    let writer: Promise<unknown> | undefined;
    let snapshot: Promise<unknown> | undefined;
    const migrationState = await setupSql<{ relation_name: string | null }[]>`
      select to_regclass('public.content_export_jobs')::text as relation_name
    `;
    if (!migrationState[0]?.relation_name) {
      throw new Error("Migration 0139 must be applied before the content export locking proof");
    }

    try {
      await setupSql`insert into users (id, state) values (${userId}, 'active')`;
      await setupSql`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state, caption
        ) values (
          ${contentId}, ${userId}, 'carousel', 'draft', 'draft',
          'private', 'none', 'pending', 'before snapshot'
        )
      `;
      await setupSql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state,
          asset_kind, position
        ) values (
          ${firstAssetId}, ${contentId}, 'bunny', ${`snapshot-${firstAssetId}`}, 'ready',
          'image', 0
        )
      `;

      writer = writerSql.begin(async (transaction) => {
        await transaction`
          update content_items
          set caption = 'after snapshot lock', updated_at = clock_timestamp()
          where id = ${contentId}
        `;
        await transaction`
          update media_assets set position = 1 where id = ${firstAssetId}
        `;
        await transaction`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            asset_kind, position
          ) values (
            ${secondAssetId}, ${contentId}, 'bunny', ${`snapshot-${secondAssetId}`}, 'ready',
            'image', 0
          )
        `;
        markWriterReady();
        await writerGate;
      });
      await writerReady;

      snapshot = snapshotSql.begin(async (transaction) => {
        await transaction`set local statement_timeout = '5s'`;
        await transaction`
          insert into data_requests (
            id, requester_user_id, type, state, idempotency_key, updated_at
          ) values (
            ${dataRequestId}, ${userId}, 'export', 'requested',
            ${`snapshot-lock-${dataRequestId}`}, clock_timestamp()
          )
        `;
      });

      // The request must be waiting on the content row while the composition
      // mutation holds it. Releasing the writer then lets the snapshot observe
      // one committed metadata+asset revision.
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseWriter();
      await Promise.all([writer, snapshot]);

      const contents = await setupSql<Array<{
        caption: string | null;
        composition_revision: number;
      }>>`
        select snapshot.caption, snapshot.composition_revision
        from content_export_job_contents snapshot
        join content_export_jobs job on job.id = snapshot.job_id
        where job.data_request_id = ${dataRequestId}
      `;
      const items = await setupSql<Array<{
        composition_revision: number;
        media_asset_id: string;
      }>>`
        select item.composition_revision, item.media_asset_id
        from content_export_job_items item
        join content_export_jobs job on job.id = item.job_id
        where job.data_request_id = ${dataRequestId}
        order by item.media_asset_id
      `;

      expect(contents).toHaveLength(1);
      expect(contents[0]?.caption).toBe("after snapshot lock");
      expect(items.map((item) => item.media_asset_id).sort()).toEqual(
        [firstAssetId, secondAssetId].sort()
      );
      expect(new Set(items.map((item) => Number(item.composition_revision)))).toEqual(
        new Set([Number(contents[0]?.composition_revision)])
      );
    } finally {
      releaseWriter();
      await Promise.allSettled([writer, snapshot].filter(Boolean) as Promise<unknown>[]);
      await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
      await setupSql`
        delete from content_export_download_grants
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_job_items
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_job_contents
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`delete from content_export_jobs where data_request_id = ${dataRequestId}`;
      await setupSql`delete from data_requests where id = ${dataRequestId}`;
      await setupSql`delete from media_assets where content_item_id = ${contentId}`;
      await setupSql`delete from content_items where id = ${contentId}`;
      await setupSql`delete from users where id = ${userId}`;
    }
  });

  it("persists an upload-start fence before allowing non-ready cleanup quarantine", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const userId = randomUUID();
    const dataRequestId = randomUUID();
    const leaseToken = randomUUID();
    try {
      await setupSql`insert into users (id, state) values (${userId}, 'active')`;
      await setupSql`
        insert into data_requests (
          id, requester_user_id, type, state, idempotency_key, updated_at
        ) values (
          ${dataRequestId}, ${userId}, 'export', 'requested',
          ${`upload-fence-${dataRequestId}`}, clock_timestamp()
        )
      `;
      await setupSql`
        update content_export_jobs
        set state = 'processing', next_attempt_at = null,
            lease_token = ${leaseToken}, leased_until = clock_timestamp() + interval '5 minutes'
        where data_request_id = ${dataRequestId}
      `;

      await expect(setupSql`
        update content_export_jobs
        set cleanup_state = 'manual_confirmation_required'
        where data_request_id = ${dataRequestId}
      `).rejects.toMatchObject({ code: "23514" });

      await setupSql`
        update content_export_jobs
        set cleanup_state = 'manual_confirmation_required',
            archive_upload_started_at = clock_timestamp()
        where data_request_id = ${dataRequestId}
      `;
      await setupSql`
        update content_export_jobs
        set state = 'retry', next_attempt_at = clock_timestamp(),
            lease_token = null, leased_until = null
        where data_request_id = ${dataRequestId}
      `;
      const rows = await setupSql<Array<{
        cleanup_state: string;
        archive_upload_started_at: Date | null;
      }>>`
        select cleanup_state, archive_upload_started_at
        from content_export_jobs
        where data_request_id = ${dataRequestId}
      `;
      expect(rows[0]).toMatchObject({
        cleanup_state: "manual_confirmation_required",
        archive_upload_started_at: expect.any(Date)
      });
    } finally {
      await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
      await setupSql`
        delete from content_export_job_items
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_job_contents
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`delete from content_export_jobs where data_request_id = ${dataRequestId}`;
      await setupSql`delete from data_requests where id = ${dataRequestId}`;
      await setupSql`delete from users where id = ${userId}`;
    }
  });

  it("runs 0141 against retained legal started-object states before a winner can replace the key", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const schema = `export_attempt_migration_${randomUUID().replaceAll("-", "")}`;
    const migrationSql = readFileSync(
      new URL("../migrations/0141_content_export_attempt_fencing.sql", import.meta.url),
      "utf8"
    );

    await inRolledBackTransaction(setupSql, async (transaction) => {
      await transaction.unsafe(`create schema ${schema}`);
      await transaction.unsafe(`set local search_path = ${schema}, public, extensions`);
      await transaction.unsafe(`
        create table content_export_jobs (
          id uuid primary key,
          attempt_count integer not null check (attempt_count between 0 and 8),
          lease_token uuid,
          archive_object_key text not null unique,
          state text not null check (state in (
            'queued', 'processing', 'retry', 'ready', 'cancelled', 'dead_letter', 'expired'
          )),
          archive_upload_started_at timestamptz,
          archive_ready_at timestamptz,
          archive_byte_size bigint,
          archive_sha256 text,
          cleanup_state text not null check (cleanup_state in (
            'not_ready', 'retained_private', 'manual_confirmation_required', 'manual_delete_confirmed'
          )),
          created_at timestamptz not null default clock_timestamp(),
          check (
            (state in ('ready', 'expired') and archive_upload_started_at is not null
              and archive_ready_at is not null and archive_byte_size is not null
              and archive_sha256 is not null)
            or (state in ('queued', 'processing', 'retry', 'cancelled', 'dead_letter')
              and archive_ready_at is null and archive_byte_size is null and archive_sha256 is null
              and ((cleanup_state = 'not_ready' and archive_upload_started_at is null)
                or (cleanup_state = 'manual_confirmation_required'
                  and archive_upload_started_at is not null)))
          )
        )
      `);

      const startedAt = new Date("2026-11-01T00:00:00.000Z");
      const readyAt = new Date("2026-11-01T00:01:00.000Z");
      const retained = [
        { state: "queued", attemptCount: 0 },
        { state: "retry", attemptCount: 2 },
        { state: "cancelled", attemptCount: 4 },
        { state: "dead_letter", attemptCount: 8 }
      ] as const;
      for (const fixture of retained) {
        const jobId = randomUUID();
        await transaction`
          insert into content_export_jobs (
            id, attempt_count, archive_object_key, state,
            archive_upload_started_at, cleanup_state
          ) values (
            ${jobId}, ${fixture.attemptCount},
            ${`exports/${jobId}/${randomUUID()}.tar`}, ${fixture.state},
            ${startedAt}, 'manual_confirmation_required'
          )
        `;
      }
      const readyJobId = randomUUID();
      await transaction`
        insert into content_export_jobs (
          id, attempt_count, archive_object_key, state,
          archive_upload_started_at, archive_ready_at, archive_byte_size,
          archive_sha256, cleanup_state
        ) values (
          ${readyJobId}, 3, ${`exports/${readyJobId}/${randomUUID()}.tar`}, 'ready',
          ${startedAt}, ${readyAt}, 4096, ${"a".repeat(64)}, 'retained_private'
        )
      `;

      await transaction.unsafe(migrationSql);

      const attempts = await transaction<Array<{
        attempt_sequence: string;
        job_state: string;
        state: string;
        upload_started_at: Date | null;
        published_at: Date | null;
      }>>`
        select attempt.attempt_sequence, job.state as job_state, attempt.state,
          attempt.upload_started_at, attempt.published_at
        from content_export_archive_attempts attempt
        join content_export_jobs job on job.id = attempt.job_id
        order by job.state
      `;
      expect(attempts).toEqual([
        expect.objectContaining({ job_state: "cancelled", attempt_sequence: "4", state: "cleanup_required" }),
        expect.objectContaining({ job_state: "dead_letter", attempt_sequence: "8", state: "cleanup_required" }),
        expect.objectContaining({ job_state: "queued", attempt_sequence: "1", state: "cleanup_required" }),
        expect.objectContaining({ job_state: "ready", attempt_sequence: "3", state: "published" }),
        expect.objectContaining({ job_state: "retry", attempt_sequence: "2", state: "cleanup_required" })
      ]);
      expect(attempts.every((attempt) => attempt.upload_started_at instanceof Date)).toBe(true);
      expect(attempts.filter((attempt) => attempt.job_state === "ready"))
        .toEqual([expect.objectContaining({ published_at: readyAt })]);
      expect(attempts.filter((attempt) => attempt.job_state !== "ready")
        .every((attempt) => attempt.published_at === null)).toBe(true);

      const counters = await transaction<Array<{
        archive_attempt_sequence: string;
        state: string;
      }>>`
        select archive_attempt_sequence, state from content_export_jobs order by state
      `;
      expect(counters).toEqual([
        { state: "cancelled", archive_attempt_sequence: "4" },
        { state: "dead_letter", archive_attempt_sequence: "8" },
        { state: "queued", archive_attempt_sequence: "1" },
        { state: "ready", archive_attempt_sequence: "3" },
        { state: "retry", archive_attempt_sequence: "2" }
      ]);
    });
  }, 30_000);

  it("runs the native repository through worker upload and system-tar hash restore", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const userId = randomUUID();
    const contentId = randomUUID();
    const imageAssetId = randomUUID();
    const videoAssetId = randomUUID();
    const dataRequestId = randomUUID();
    const imageBytes = Buffer.from("retained-sanitized-image-bytes", "utf8");
    const videoBytes = Buffer.from("retained-provider-video-bytes", "utf8");
    let archive = Buffer.alloc(0);
    let archiveObjectKey = "";
    const restoreDirectory = mkdtempSync(join(tmpdir(), "wevid-native-content-export-"));

    try {
      const migrationState = await setupSql<{ relation_name: string | null }[]>`
        select to_regclass('public.content_export_archive_attempts')::text as relation_name
      `;
      if (!migrationState[0]?.relation_name) {
        throw new Error("Migration 0141 must be applied before the native content export proof");
      }
      await setupSql`insert into users (id, state) values (${userId}, 'active')`;
      await setupSql`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state, caption
        ) values (
          ${contentId}, ${userId}, 'carousel', 'draft', 'draft',
          'private', 'none', 'pending', 'Native export fixture'
        )
      `;
      await setupSql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state,
          asset_kind, position, mime_type, checksum_sha256
        ) values
          (
            ${imageAssetId}, ${contentId}, 'bunny', ${`retained-image-${imageAssetId}`}, 'ready',
            'image', 0, 'image/webp', ${createHash("sha256").update(imageBytes).digest("hex")}
          ),
          (
            ${videoAssetId}, ${contentId}, 'bunny', ${`retained-video-${videoAssetId}`}, 'ready',
            'video', 1, 'video/mp4', ${createHash("sha256").update(videoBytes).digest("hex")}
          )
      `;
      await setupSql`
        insert into data_requests (
          id, requester_user_id, type, state, idempotency_key, updated_at
        ) values (
          ${dataRequestId}, ${userId}, 'export', 'requested',
          ${`native-export-${dataRequestId}`}, clock_timestamp()
        )
      `;

      const provider: ContentExportProvider = {
        async openSource(input) {
          const source = input.providerObjectReference === `retained-image-${imageAssetId}`
            ? imageBytes
            : input.providerObjectReference === `retained-video-${videoAssetId}`
              ? videoBytes
              : null;
          if (!source) return { state: "unavailable", reason: "source_object_missing" };
          return {
            state: "available",
            byteLength: source.byteLength,
            body: (async function* () { yield source; })()
          };
        },
        async uploadArchive(input) {
          archiveObjectKey = input.archiveObjectKey;
          const chunks: Buffer[] = [];
          for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
          archive = Buffer.concat(chunks);
        }
      };
      const repository = createPostgresContentExportRepository({ sql: setupSql });
      const result = await processContentExports({ repository, provider, limit: 1 });

      expect(result).toMatchObject({ leased: 1, ready: 1, deadLettered: 0, retrying: 0 });
      const rows = await setupSql<Array<{
        archive_object_key: string;
        archive_sha256: string;
        state: string;
      }>>`
        select archive_object_key, archive_sha256, state
        from content_export_jobs
        where data_request_id = ${dataRequestId}
      `;
      expect(rows).toEqual([{
        archive_object_key: archiveObjectKey,
        archive_sha256: createHash("sha256").update(archive).digest("hex"),
        state: "ready"
      }]);
      expect(archiveObjectKey).toMatch(new RegExp(`^exports/${userId}/[0-9a-f-]{36}\\.tar$`));
      const attempts = await setupSql<Array<{ object_key: string; state: string }>>`
        select object_key, state
        from content_export_archive_attempts
        where job_id = (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      expect(attempts).toEqual([{ object_key: archiveObjectKey, state: "published" }]);

      const archivePath = join(restoreDirectory, "export.tar");
      const restoredPath = join(restoreDirectory, "restored");
      writeFileSync(archivePath, archive);
      mkdirSync(restoredPath);
      const extracted = spawnSync("tar", ["-xf", archivePath, "-C", restoredPath], { encoding: "utf8" });
      expect(extracted.status, extracted.stderr).toBe(0);
      expect(readFileSync(join(restoredPath, `content/${contentId}/assets/${imageAssetId}.webp`)))
        .toEqual(imageBytes);
      expect(readFileSync(join(restoredPath, `content/${contentId}/assets/${videoAssetId}.mp4`)))
        .toEqual(videoBytes);
    } finally {
      rmSync(restoreDirectory, { recursive: true, force: true });
      await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
      await setupSql`
        delete from content_export_download_grants
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_archive_attempts
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_job_items
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`
        delete from content_export_job_contents
        where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
      `;
      await setupSql`delete from content_export_jobs where data_request_id = ${dataRequestId}`;
      await setupSql`delete from data_requests where id = ${dataRequestId}`;
      await setupSql`delete from media_assets where content_item_id = ${contentId}`;
      await setupSql`delete from content_items where id = ${contentId}`;
      await setupSql`delete from users where id = ${userId}`;
    }
  }, 60_000);

  for (const transition of ["safety", "provider_cleanup"] as const) {
    it(`keeps a ${transition} transition between upload and finalization private`, async () => {
      if (!setupSql || !writerSql) {
        throw new Error("Content export locking database was not initialized");
      }
      const userId = randomUUID();
      const contentId = randomUUID();
      const mediaAssetId = randomUUID();
      const dataRequestId = randomUUID();
      const sourceBytes = Buffer.from(`finalization-race-${transition}`, "utf8");
      const sourceReference = `finalization-race-${transition}-${mediaAssetId}`;
      const finalizationReached = deferred<void>();
      const releaseFinalization = deferred<void>();
      let worker: ReturnType<typeof processContentExports> | undefined;
      let outcomeBeforeFinalization: string | null = null;
      let uploadedObjectKey = "";

      try {
        await setupSql`insert into users (id, state) values (${userId}, 'active')`;
        await setupSql`
          insert into content_items (
            id, creator_user_id, media_type, state, publish_state,
            visibility, nsfw_label, moderation_state, caption
          ) values (
            ${contentId}, ${userId}, 'image', 'draft', 'draft',
            'private', 'none', 'pending', 'Finalization race fixture'
          )
        `;
        if (transition === "provider_cleanup") {
          await setupSql`
            insert into media_assets (
              id, content_item_id, provider, provider_asset_id, provider_state,
              asset_kind, position, mime_type, checksum_sha256,
              retired_at, retired_by_user_id, retirement_reason,
              provider_cleanup_state, provider_cleanup_next_attempt_at
            ) values (
              ${mediaAssetId}, ${contentId}, 'bunny', ${sourceReference}, 'ready',
              'image', null, 'image/webp',
              ${createHash("sha256").update(sourceBytes).digest("hex")},
              clock_timestamp(), ${userId}, 'finalization race fixture',
              'pending', clock_timestamp()
            )
          `;
        } else {
          await setupSql`
            insert into media_assets (
              id, content_item_id, provider, provider_asset_id, provider_state,
              asset_kind, position, mime_type, checksum_sha256
            ) values (
              ${mediaAssetId}, ${contentId}, 'bunny', ${sourceReference}, 'ready',
              'image', 0, 'image/webp',
              ${createHash("sha256").update(sourceBytes).digest("hex")}
            )
          `;
        }
        await setupSql`
          insert into data_requests (
            id, requester_user_id, type, state, idempotency_key, updated_at
          ) values (
            ${dataRequestId}, ${userId}, 'export', 'requested',
            ${`finalization-race-${transition}-${dataRequestId}`}, clock_timestamp()
          )
        `;
        const jobs = await setupSql<Array<{ id: string }>>`
          select id from content_export_jobs where data_request_id = ${dataRequestId}
        `;
        const jobId = jobs[0]?.id;
        if (!jobId) throw new Error("Finalization race fixture did not create an export job");

        const postgresRepository = createPostgresContentExportRepository({ sql: writerSql });
        const repository: ContentExportRepository = {
          ...postgresRepository,
          async recordJobOutcome(input) {
            outcomeBeforeFinalization = input.outcome.state;
            finalizationReached.resolve(undefined);
            await releaseFinalization.promise;
            return postgresRepository.recordJobOutcome(input);
          }
        };
        worker = processContentExports({
          repository,
          provider: {
            async openSource(input) {
              if (input.providerObjectReference !== sourceReference) {
                return { state: "unavailable", reason: "source_object_missing" };
              }
              return {
                state: "available",
                byteLength: sourceBytes.byteLength,
                body: (async function* () { yield sourceBytes; })()
              };
            },
            async uploadArchive(input) {
              uploadedObjectKey = input.archiveObjectKey;
              for await (const _chunk of input.body) {
                // The provider accepted the complete private archive.
              }
            }
          },
          limit: 1
        });

        await finalizationReached.promise;
        expect(outcomeBeforeFinalization).toBe("ready");
        expect(await setupSql<Array<{ state: string }>>`
          select state from content_export_archive_attempts where job_id = ${jobId}
        `).toEqual([{ state: "uploaded" }]);

        if (transition === "safety") {
          await setupSql`
            update content_items
            set state = 'blocked', publish_state = 'blocked',
                moderation_state = 'blocked', updated_at = clock_timestamp()
            where id = ${contentId}
          `;
        } else {
          await setupSql`
            update media_assets
            set provider_cleanup_state = 'completed',
                provider_cleanup_attempt_count = provider_cleanup_attempt_count + 1,
                provider_cleanup_next_attempt_at = null,
                provider_cleanup_lease_token = null,
                provider_cleanup_leased_until = null
            where id = ${mediaAssetId}
          `;
        }

        releaseFinalization.resolve(undefined);
        await expect(worker).resolves.toMatchObject({
          leased: 1,
          ready: 0,
          retrying: 0,
          deadLettered: 1,
          cancelled: 0
        });
        worker = undefined;

        expect(await setupSql<Array<{
          state: string;
          cleanup_state: string;
          last_error_code: string | null;
          archive_byte_size: string | null;
          archive_sha256: string | null;
          archive_ready_at: Date | null;
          downloadable_until: Date | null;
        }>>`
          select state, cleanup_state, last_error_code, archive_byte_size,
            archive_sha256, archive_ready_at, downloadable_until
          from content_export_jobs
          where id = ${jobId}
        `).toEqual([{
          state: "dead_letter",
          cleanup_state: "manual_confirmation_required",
          last_error_code: "export_source_restricted_before_release",
          archive_byte_size: null,
          archive_sha256: null,
          archive_ready_at: null,
          downloadable_until: null
        }]);
        const attempts = await setupSql<Array<{
          object_key: string;
          state: string;
          upload_started_at: Date | null;
          upload_completed_at: Date | null;
          published_at: Date | null;
          archive_byte_size: string | null;
          archive_sha256: string | null;
        }>>`
          select object_key, state, upload_started_at, upload_completed_at,
            published_at, archive_byte_size, archive_sha256
          from content_export_archive_attempts
          where job_id = ${jobId}
        `;
        expect(attempts).toEqual([expect.objectContaining({
          object_key: uploadedObjectKey,
          state: "cleanup_required",
          upload_started_at: expect.any(Date),
          upload_completed_at: expect.any(Date),
          published_at: null,
          archive_byte_size: expect.any(String),
          archive_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        })]);
        expect(await setupSql<Array<{ state: string; reason: string | null }>>`
          select state, reason from data_requests where id = ${dataRequestId}
        `).toEqual([{
          state: "failed",
          reason: "export_source_restricted_before_release"
        }]);
        expect(await setupSql<Array<{ metadata: Record<string, unknown> }>>`
          select metadata from audit_events
          where actor_user_id = ${userId}
            and subject_id = ${jobId}
            and action = 'content_export_dead_letter'
        `).toEqual([{
          metadata: expect.objectContaining({
            errorCode: "export_source_restricted_before_release"
          })
        }]);
      } finally {
        releaseFinalization.resolve(undefined);
        await Promise.allSettled(worker ? [worker] : []);
        await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
        await setupSql`
          delete from content_export_download_grants
          where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
        `;
        await setupSql`
          delete from content_export_archive_attempts
          where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
        `;
        await setupSql`
          delete from content_export_job_items
          where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
        `;
        await setupSql`
          delete from content_export_job_contents
          where job_id in (select id from content_export_jobs where data_request_id = ${dataRequestId})
        `;
        await setupSql`delete from content_export_jobs where data_request_id = ${dataRequestId}`;
        await setupSql`delete from data_requests where id = ${dataRequestId}`;
        await setupSql`delete from media_assets where id = ${mediaAssetId}`;
        await setupSql`delete from content_items where id = ${contentId}`;
        await setupSql`delete from users where id = ${userId}`;
      }
    }, 45_000);
  }

  it("preserves cleanup evidence before an expired source hold clears its lease", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const userId = randomUUID();
    const dataRequestId = randomUUID();
    let jobId: string | undefined;

    try {
      await setupSql`insert into users (id, state) values (${userId}, 'active')`;
      await setupSql`
        insert into data_requests (
          id, requester_user_id, type, state, idempotency_key, updated_at
        ) values (
          ${dataRequestId}, ${userId}, 'export', 'requested',
          ${`source-hold-attempt-${dataRequestId}`}, clock_timestamp()
        )
      `;
      const repository = createPostgresContentExportRepository({ sql: setupSql });
      const leased = await repository.leaseDueExports({
        now: new Date(),
        limit: 1,
        leaseDurationMs: 60_000
      });
      const leasedJob = leased[0];
      if (!leasedJob) throw new Error("Content export job was not leased");
      jobId = leasedJob.jobId;
      await expect(repository.markArchiveUploadStarted({
        job: leasedJob,
        now: new Date()
      })).resolves.toBe(true);
      const expiredAt = new Date(Date.now() - 1_000);
      await setupSql`
        update content_export_jobs
        set snapshot_created_at = ${new Date(expiredAt.getTime() - 24 * 60 * 60 * 1000)},
            source_hold_until = ${expiredAt}, leased_until = ${expiredAt}
        where id = ${jobId}
      `;

      await expect(repository.expireElapsedSourceHolds({
        now: new Date(),
        limit: 1
      })).resolves.toBe(1);

      const attempts = await setupSql<Array<{ state: string }>>`
        select state from content_export_archive_attempts where job_id = ${jobId}
      `;
      expect(attempts).toEqual([{ state: "cleanup_required" }]);
      const jobs = await setupSql<Array<{
        state: string;
        lease_token: string | null;
        leased_until: Date | null;
      }>>`
        select state, lease_token, leased_until from content_export_jobs where id = ${jobId}
      `;
      expect(jobs).toEqual([{ state: "dead_letter", lease_token: null, leased_until: null }]);

      const apiRepository = createApiContentExportRepository(setupSql);
      await expect(apiRepository.retry({
        userId,
        jobId,
        idempotencyKey: `source-hold-retry-${jobId}`
      })).resolves.toMatchObject({ state: "queued", attemptCount: 0 });
      const winner = await processContentExports({
        repository,
        provider: {
          async openSource() {
            throw new Error("An empty export must not read a provider source");
          },
          async uploadArchive(input) {
            for await (const _chunk of input.body) {
              // Consume the manifest-only private archive.
            }
          }
        },
        limit: 1
      });
      expect(winner).toMatchObject({ leased: 1, ready: 1 });
      const attemptsAfterWinner = await setupSql<Array<{
        attempt_sequence: string;
        state: string;
      }>>`
        select attempt_sequence, state
        from content_export_archive_attempts
        where job_id = ${jobId}
        order by attempt_sequence
      `;
      expect(attemptsAfterWinner).toEqual([
        { attempt_sequence: "1", state: "cleanup_required" },
        { attempt_sequence: "2", state: "published" }
      ]);
      const winningJob = await setupSql<Array<{ cleanup_state: string; state: string }>>`
        select cleanup_state, state from content_export_jobs where id = ${jobId}
      `;
      expect(winningJob).toEqual([{ cleanup_state: "retained_private", state: "ready" }]);

      const adminPage = await createPrivacyRepository(setupSql).listDataRequests({});
      const adminRequest = adminPage.items.find((item) => item.id === dataRequestId);
      expect(adminRequest).toMatchObject({
        contentExportJobId: jobId,
        contentExportCleanupState: "retained_private",
        contentExportCleanupRequiredAttemptCount: 1,
        contentExportOldestCleanupRequiredAttemptAt: expect.any(String)
      });
    } finally {
      await setupSql`delete from mutation_command_receipts where actor_user_id = ${userId}`;
      await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
      if (jobId) {
        await setupSql`delete from content_export_download_grants where job_id = ${jobId}`;
        await setupSql`delete from content_export_archive_attempts where job_id = ${jobId}`;
        await setupSql`delete from content_export_job_items where job_id = ${jobId}`;
        await setupSql`delete from content_export_job_contents where job_id = ${jobId}`;
        await setupSql`delete from content_export_jobs where id = ${jobId}`;
      }
      await setupSql`delete from data_requests where id = ${dataRequestId}`;
      await setupSql`delete from users where id = ${userId}`;
    }
  }, 30_000);

  it("lets a committed heartbeat win without prematurely terminalizing its archive attempt", async () => {
    if (!setupSql || !writerSql || !snapshotSql) {
      throw new Error("Content export locking database was not initialized");
    }
    const fixture = await createEmptyExportFixture(setupSql, "heartbeat-reclaim");
    const releaseHeartbeat = deferred<void>();
    const heartbeatUpdated = deferred<void>();
    let heartbeatTransaction: Promise<unknown> | undefined;

    try {
      const repository = createPostgresContentExportRepository({ sql: setupSql });
      const heartbeatNow = new Date();
      const leased = await repository.leaseDueExports({
        now: heartbeatNow,
        limit: 1,
        leaseDurationMs: 60_000
      });
      const job = leased[0];
      if (!job) throw new Error("Content export job was not leased");
      await setupSql`
        update content_export_jobs
        set leased_until = ${new Date(heartbeatNow.getTime() + 10_000)}
        where id = ${fixture.jobId}
      `;

      heartbeatTransaction = writerSql.begin(async (transaction) => {
        const heartbeatRepository = createPostgresContentExportRepository({
          sql: transaction as unknown as postgres.Sql
        });
        expect(await heartbeatRepository.heartbeat({
          job,
          now: heartbeatNow,
          leaseDurationMs: 60_000
        })).toBe(true);
        heartbeatUpdated.resolve(undefined);
        await releaseHeartbeat.promise;
      });
      await heartbeatUpdated.promise;

      const reclaimer = createPostgresContentExportRepository({ sql: snapshotSql });
      const reclaimNow = new Date(heartbeatNow.getTime() + 30_000);
      await expect(reclaimer.leaseDueExports({
        now: reclaimNow,
        limit: 1,
        leaseDurationMs: 60_000
      })).resolves.toEqual([]);
      expect(await setupSql<Array<{ state: string }>>`
        select state from content_export_archive_attempts where job_id = ${fixture.jobId}
      `).toEqual([{ state: "allocated" }]);

      releaseHeartbeat.resolve(undefined);
      await heartbeatTransaction;
      heartbeatTransaction = undefined;
      await expect(reclaimer.leaseDueExports({
        now: reclaimNow,
        limit: 1,
        leaseDurationMs: 60_000
      })).resolves.toEqual([]);
      expect(await setupSql<Array<{
        attempt_state: string;
        job_state: string;
        lease_token: string | null;
      }>>`
        select attempt.state as attempt_state, job.state as job_state, job.lease_token
        from content_export_jobs job
        join content_export_archive_attempts attempt on attempt.job_id = job.id
        where job.id = ${fixture.jobId}
      `).toEqual([{
        attempt_state: "allocated",
        job_state: "processing",
        lease_token: job.leaseToken
      }]);
    } finally {
      releaseHeartbeat.resolve(undefined);
      await Promise.allSettled(heartbeatTransaction ? [heartbeatTransaction] : []);
      await cleanupExportFixture(setupSql, fixture);
    }
  }, 30_000);

  it("keeps a slow stale upload isolated when a later lease publishes the winner", async () => {
    if (!setupSql || !writerSql || !snapshotSql) {
      throw new Error("Content export locking database was not initialized");
    }
    const fixture = await createEmptyExportFixture(setupSql, "slow-stale-winner");
    const staleUploadAccepted = deferred<void>();
    const releaseStaleUpload = deferred<void>();
    let staleWorker: Promise<unknown> | undefined;
    let staleObjectKey = "";
    let winningObjectKey = "";

    try {
      staleWorker = processContentExports({
        repository: createPostgresContentExportRepository({ sql: writerSql }),
        provider: {
          async openSource() {
            throw new Error("An empty export must not open provider source media");
          },
          async uploadArchive(input) {
            staleObjectKey = input.archiveObjectKey;
            for await (const _chunk of input.body) {
              // Provider accepted every byte before its response stalled.
            }
            staleUploadAccepted.resolve(undefined);
            await releaseStaleUpload.promise;
          }
        },
        now: new Date(),
        limit: 1,
        leaseDurationMs: 60_000
      });
      await staleUploadAccepted.promise;
      const reclaimNow = new Date();
      await setupSql`
        update content_export_jobs
        set leased_until = ${new Date(reclaimNow.getTime() - 1_000)}
        where id = ${fixture.jobId}
      `;

      const winner = await processContentExports({
        repository: createPostgresContentExportRepository({ sql: snapshotSql }),
        provider: {
          async openSource() {
            throw new Error("An empty export must not open provider source media");
          },
          async uploadArchive(input) {
            winningObjectKey = input.archiveObjectKey;
            for await (const _chunk of input.body) {
              // Consume the winning private archive.
            }
          }
        },
        now: reclaimNow,
        limit: 1,
        leaseDurationMs: 60_000
      });
      expect(winner).toMatchObject({ leased: 1, ready: 1 });

      releaseStaleUpload.resolve(undefined);
      await expect(staleWorker).resolves.toMatchObject({ leased: 1, ready: 0, cancelled: 0 });
      staleWorker = undefined;

      expect(await setupSql<Array<{ archive_object_key: string; state: string }>>`
        select archive_object_key, state from content_export_jobs where id = ${fixture.jobId}
      `).toEqual([{ archive_object_key: winningObjectKey, state: "ready" }]);
      expect(staleObjectKey).not.toBe(winningObjectKey);
      expect(await setupSql<Array<{ object_key: string; state: string }>>`
        select object_key, state
        from content_export_archive_attempts
        where job_id = ${fixture.jobId}
        order by attempt_sequence
      `).toEqual([
        { object_key: staleObjectKey, state: "cleanup_required" },
        { object_key: winningObjectKey, state: "published" }
      ]);
    } finally {
      releaseStaleUpload.resolve(undefined);
      await Promise.allSettled(staleWorker ? [staleWorker] : []);
      await cleanupExportFixture(setupSql, fixture);
    }
  }, 30_000);

  it("keeps cancellation during an accepted PUT private and visible to admin cleanup", async () => {
    if (!setupSql || !writerSql) {
      throw new Error("Content export locking database was not initialized");
    }
    const fixture = await createEmptyExportFixture(setupSql, "cancel-during-put");
    const uploadAccepted = deferred<void>();
    const releaseUpload = deferred<void>();
    let worker: Promise<unknown> | undefined;

    try {
      worker = processContentExports({
        repository: createPostgresContentExportRepository({ sql: writerSql }),
        provider: {
          async openSource() {
            throw new Error("An empty export must not open provider source media");
          },
          async uploadArchive(input) {
            for await (const _chunk of input.body) {
              // The provider accepted the object before cancellation won.
            }
            uploadAccepted.resolve(undefined);
            await releaseUpload.promise;
          }
        },
        limit: 1
      });
      await uploadAccepted.promise;
      await expect(createApiContentExportRepository(setupSql).cancel({
        userId: fixture.userId,
        jobId: fixture.jobId,
        idempotencyKey: `cancel-during-put-${fixture.jobId}`
      })).resolves.toMatchObject({ state: "processing" });

      releaseUpload.resolve(undefined);
      await expect(worker).resolves.toMatchObject({ leased: 1, cancelled: 1, ready: 0 });
      worker = undefined;

      expect(await setupSql<Array<{
        attempt_state: string;
        job_state: string;
      }>>`
        select attempt.state as attempt_state, job.state as job_state
        from content_export_jobs job
        join content_export_archive_attempts attempt on attempt.job_id = job.id
        where job.id = ${fixture.jobId}
      `).toEqual([{ attempt_state: "cleanup_required", job_state: "cancelled" }]);
      const adminPage = await createPrivacyRepository(setupSql).listDataRequests({});
      expect(adminPage.items.find((item) => item.id === fixture.dataRequestId)).toMatchObject({
        contentExportCleanupRequiredAttemptCount: 1,
        contentExportOldestCleanupRequiredAttemptAt: expect.any(String)
      });
    } finally {
      releaseUpload.resolve(undefined);
      await Promise.allSettled(worker ? [worker] : []);
      await cleanupExportFixture(setupSql, fixture);
    }
  }, 30_000);

  it("restarts after a lost provider response without reusing or publishing the old object", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const fixture = await createEmptyExportFixture(setupSql, "lost-upload-response");
    const repository = createPostgresContentExportRepository({ sql: setupSql });
    let lostObjectKey = "";
    let winningObjectKey = "";

    try {
      const first = await processContentExports({
        repository,
        provider: {
          async openSource() {
            throw new Error("An empty export must not open provider source media");
          },
          async uploadArchive(input) {
            lostObjectKey = input.archiveObjectKey;
            for await (const _chunk of input.body) {
              // The provider accepted the bytes, but its response was lost.
            }
            throw new Error("provider accepted bytes but response was lost");
          }
        },
        limit: 1
      });
      expect(first).toMatchObject({ leased: 1, retrying: 1, ready: 0 });
      const retry = await setupSql<Array<{ next_attempt_at: Date }>>`
        select next_attempt_at from content_export_jobs where id = ${fixture.jobId}
      `;
      const retryAt = retry[0]?.next_attempt_at;
      if (!retryAt) throw new Error("Lost-response export did not schedule a retry");

      const second = await processContentExports({
        repository,
        provider: {
          async openSource() {
            throw new Error("An empty export must not open provider source media");
          },
          async uploadArchive(input) {
            winningObjectKey = input.archiveObjectKey;
            for await (const _chunk of input.body) {
              // Consume the retry archive.
            }
          }
        },
        now: new Date(retryAt.getTime() + 1),
        limit: 1
      });
      expect(second).toMatchObject({ leased: 1, ready: 1, retrying: 0 });
      expect(winningObjectKey).not.toBe(lostObjectKey);
      expect(await setupSql<Array<{ object_key: string; state: string }>>`
        select object_key, state
        from content_export_archive_attempts
        where job_id = ${fixture.jobId}
        order by attempt_sequence
      `).toEqual([
        { object_key: lostObjectKey, state: "cleanup_required" },
        { object_key: winningObjectKey, state: "published" }
      ]);
      expect(await setupSql<Array<{ archive_object_key: string; state: string }>>`
        select archive_object_key, state from content_export_jobs where id = ${fixture.jobId}
      `).toEqual([{ archive_object_key: winningObjectKey, state: "ready" }]);
    } finally {
      await cleanupExportFixture(setupSql, fixture);
    }
  }, 30_000);

  it("reports no manual cleanup for an exhausted lease abandoned before upload", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const fixture = await createEmptyExportFixture(setupSql, "exhausted-before-upload");

    try {
      const repository = createPostgresContentExportRepository({ sql: setupSql });
      const leased = await repository.leaseDueExports({
        now: new Date(),
        limit: 1,
        leaseDurationMs: 60_000
      });
      if (!leased[0]) throw new Error("Content export job was not leased");
      const reclaimNow = new Date();
      await setupSql`
        update content_export_jobs
        set attempt_count = 8, leased_until = ${new Date(reclaimNow.getTime() - 1_000)}
        where id = ${fixture.jobId}
      `;
      await setupSql`
        update content_export_archive_attempts
        set attempt_count = 8
        where job_id = ${fixture.jobId}
      `;

      await expect(repository.leaseDueExports({
        now: reclaimNow,
        limit: 1,
        leaseDurationMs: 60_000
      })).resolves.toEqual([]);
      expect(await setupSql<Array<{ state: string }>>`
        select state from content_export_archive_attempts where job_id = ${fixture.jobId}
      `).toEqual([{ state: "abandoned" }]);
      expect(await setupSql<Array<{ metadata: Record<string, unknown> }>>`
        select metadata from audit_events
        where actor_user_id = ${fixture.userId}
          and subject_id = ${fixture.jobId}
          and action = 'content_export_attempt_budget_exhausted'
      `).toEqual([{
        metadata: expect.objectContaining({
          archiveAttemptState: "abandoned",
          cleanupRequiresConfirmation: false
        })
      }]);
      const adminPage = await createPrivacyRepository(setupSql).listDataRequests({});
      expect(adminPage.items.find((item) => item.id === fixture.dataRequestId)).toMatchObject({
        contentExportCleanupState: "not_ready",
        contentExportCleanupRequiredAttemptCount: 0,
        contentExportOldestCleanupRequiredAttemptAt: null
      });
    } finally {
      await cleanupExportFixture(setupSql, fixture);
    }
  }, 30_000);

  it("keeps archive-attempt identity monotonic across an owner dead-letter retry", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    const userId = randomUUID();
    const dataRequestId = randomUUID();
    let jobId: string | undefined;

    try {
      await setupSql`insert into users (id, state) values (${userId}, 'active')`;
      await setupSql`
        insert into data_requests (
          id, requester_user_id, type, state, idempotency_key, updated_at
        ) values (
          ${dataRequestId}, ${userId}, 'export', 'requested',
          ${`archive-sequence-${dataRequestId}`}, clock_timestamp()
        )
      `;
      const jobs = await setupSql<Array<{ id: string }>>`
        select id from content_export_jobs where data_request_id = ${dataRequestId}
      `;
      jobId = jobs[0]?.id;
      if (!jobId) throw new Error("Content export job was not created");

      const workerRepository = createPostgresContentExportRepository({ sql: setupSql });
      const leaseInput = { now: new Date(), limit: 1, leaseDurationMs: 60_000 };
      const firstLease = await workerRepository.leaseDueExports(leaseInput);
      expect(firstLease[0]).toMatchObject({
        jobId,
        attemptCount: 1,
        archiveAttemptSequence: "1"
      });
      await expect(workerRepository.recordJobOutcome({
        job: firstLease[0]!,
        now: new Date(),
        outcome: { state: "dead_letter", errorCode: "native_attempt_one_failed" }
      })).resolves.toMatchObject({ state: "dead_letter" });

      const apiRepository = createApiContentExportRepository(setupSql);
      await expect(apiRepository.retry({
        userId,
        jobId,
        idempotencyKey: `native-retry-${jobId}`
      })).resolves.toMatchObject({ state: "queued", attemptCount: 0 });

      const secondLease = await workerRepository.leaseDueExports({
        ...leaseInput,
        now: new Date()
      });
      expect(secondLease[0]).toMatchObject({
        jobId,
        attemptCount: 1,
        archiveAttemptSequence: "2"
      });
      await expect(workerRepository.recordJobOutcome({
        job: secondLease[0]!,
        now: new Date(),
        outcome: { state: "dead_letter", errorCode: "native_attempt_two_failed" }
      })).resolves.toMatchObject({ state: "dead_letter" });

      const attempts = await setupSql<Array<{
        attempt_sequence: string;
        attempt_count: number;
        state: string;
      }>>`
        select attempt_sequence, attempt_count, state
        from content_export_archive_attempts
        where job_id = ${jobId}
        order by attempt_sequence
      `;
      expect(attempts).toEqual([
        { attempt_sequence: "1", attempt_count: 1, state: "abandoned" },
        { attempt_sequence: "2", attempt_count: 1, state: "abandoned" }
      ]);
      const finalJob = await setupSql<Array<{
        archive_attempt_sequence: string;
        attempt_count: number;
        state: string;
      }>>`
        select archive_attempt_sequence, attempt_count, state
        from content_export_jobs
        where id = ${jobId}
      `;
      expect(finalJob).toEqual([{
        archive_attempt_sequence: "2",
        attempt_count: 1,
        state: "dead_letter"
      }]);
      const startAudits = await setupSql<Array<{ idempotency_key: string }>>`
        select idempotency_key
        from audit_events
        where actor_user_id = ${userId}
          and action = 'content_export_processing_started'
        order by created_at, id
      `;
      expect(startAudits.map((audit) => audit.idempotency_key)).toEqual([
        `worker:content-export:${jobId}:archive-attempt:1:started`,
        `worker:content-export:${jobId}:archive-attempt:2:started`
      ]);
    } finally {
      await setupSql`delete from mutation_command_receipts where actor_user_id = ${userId}`;
      await setupSql`delete from audit_events where actor_user_id = ${userId} and action like 'content_export_%'`;
      if (jobId) {
        await setupSql`delete from content_export_download_grants where job_id = ${jobId}`;
        await setupSql`delete from content_export_archive_attempts where job_id = ${jobId}`;
        await setupSql`delete from content_export_job_items where job_id = ${jobId}`;
        await setupSql`delete from content_export_job_contents where job_id = ${jobId}`;
        await setupSql`delete from content_export_jobs where id = ${jobId}`;
      }
      await setupSql`delete from data_requests where id = ${dataRequestId}`;
      await setupSql`delete from users where id = ${userId}`;
    }
  }, 30_000);

  it("dead-letters an oversized content inventory without partial snapshots", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    await assertOversizedInventoryRejected(setupSql, "content");
  }, 120_000);

  it("dead-letters an oversized asset inventory without partial snapshots", async () => {
    if (!setupSql) throw new Error("Content export locking database was not initialized");
    await assertOversizedInventoryRejected(setupSql, "asset");
  }, 120_000);
});

async function assertOversizedInventoryRejected(
  sql: postgres.Sql,
  dimension: "asset" | "content"
): Promise<void> {
  const userId = randomUUID();
  const dataRequestId = randomUUID();

  await inRolledBackTransaction(sql, async (transaction) => {
    await transaction`insert into users (id, state) values (${userId}, 'active')`;
    if (dimension === "content") {
      await transaction`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state
        )
        select
          gen_random_uuid(), ${userId}, 'image', 'draft', 'draft',
          'private', 'none', 'pending'
        from generate_series(1, 20001)
      `;
    } else {
      await transaction`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state
        )
        select
          gen_random_uuid(), ${userId}, 'carousel', 'draft', 'draft',
          'private', 'none', 'pending'
        from generate_series(1, 2001)
      `;
      await transaction`
        with owned_content as (
          select
            id,
            row_number() over (order by id) as ordinal
          from content_items
          where creator_user_id = ${userId}
        )
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id,
          provider_state, asset_kind, position
        )
        select
          gen_random_uuid(), content.id, 'bunny',
          ${`snapshot-limit-${dataRequestId}-`}
            || content.ordinal::text || '-' || generated.position::text,
          'ready', 'image', generated.position
        from owned_content content
        cross join lateral generate_series(
          0,
          case when content.ordinal = 2001 then 0 else 9 end
        ) as generated(position)
      `;
    }

    await transaction`
      insert into data_requests (
        id, requester_user_id, type, state, idempotency_key, updated_at
      ) values (
        ${dataRequestId}, ${userId}, 'export', 'requested',
        ${`snapshot-limit-${dimension}-${dataRequestId}`}, clock_timestamp()
      )
    `;

    const jobs = await transaction<Array<{
      id: string;
      last_error_code: string | null;
      state: string;
    }>>`
      select id, state, last_error_code
      from content_export_jobs
      where data_request_id = ${dataRequestId}
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      state: "dead_letter",
      last_error_code: "export_inventory_limit_exceeded"
    });

    const snapshots = await transaction<Array<{
      content_count: number;
      item_count: number;
    }>>`
      select
        (select count(*)::integer from content_export_job_contents where job_id = ${jobs[0]!.id})
          as content_count,
        (select count(*)::integer from content_export_job_items where job_id = ${jobs[0]!.id})
          as item_count
    `;
    expect(snapshots).toEqual([{ content_count: 0, item_count: 0 }]);

    const requests = await transaction<Array<{ reason: string | null; state: string }>>`
      select state, reason from data_requests where id = ${dataRequestId}
    `;
    expect(requests).toEqual([{
      state: "failed",
      reason: "export_inventory_limit_exceeded"
    }]);

    const audits = await transaction<Array<{ metadata: Record<string, unknown> }>>`
      select metadata
      from audit_events
      where actor_user_id = ${userId}
        and subject_id = ${jobs[0]!.id}
        and action = 'content_export_snapshot_rejected'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({
      inventoryDimension: dimension,
      maximumRows: 20000,
      observedRowsAtLeast: 20001,
      partialSnapshotPersisted: false
    });
  });
}

interface EmptyExportFixture {
  userId: string;
  dataRequestId: string;
  jobId: string;
}

async function createEmptyExportFixture(
  sql: postgres.Sql,
  label: string
): Promise<EmptyExportFixture> {
  const userId = randomUUID();
  const dataRequestId = randomUUID();
  await sql`insert into users (id, state) values (${userId}, 'active')`;
  await sql`
    insert into data_requests (
      id, requester_user_id, type, state, idempotency_key, updated_at
    ) values (
      ${dataRequestId}, ${userId}, 'export', 'requested',
      ${`${label}-${dataRequestId}`}, clock_timestamp()
    )
  `;
  const jobs = await sql<Array<{ id: string }>>`
    select id from content_export_jobs where data_request_id = ${dataRequestId}
  `;
  const jobId = jobs[0]?.id;
  if (!jobId) throw new Error(`Content export fixture ${label} did not create a job`);
  return { userId, dataRequestId, jobId };
}

async function cleanupExportFixture(
  sql: postgres.Sql,
  fixture: EmptyExportFixture
): Promise<void> {
  await sql`delete from mutation_command_receipts where actor_user_id = ${fixture.userId}`;
  await sql`delete from audit_events where actor_user_id = ${fixture.userId} and action like 'content_export_%'`;
  await sql`delete from content_export_download_grants where job_id = ${fixture.jobId}`;
  await sql`delete from content_export_archive_attempts where job_id = ${fixture.jobId}`;
  await sql`delete from content_export_job_items where job_id = ${fixture.jobId}`;
  await sql`delete from content_export_job_contents where job_id = ${fixture.jobId}`;
  await sql`delete from content_export_jobs where id = ${fixture.jobId}`;
  await sql`delete from data_requests where id = ${fixture.dataRequestId}`;
  await sql`delete from users where id = ${fixture.userId}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function inRolledBackTransaction(
  sql: postgres.Sql,
  callback: (transaction: postgres.TransactionSql) => Promise<void>
): Promise<void> {
  const rollback = Symbol("content export overflow fixture rollback");
  try {
    await sql.begin(async (transaction) => {
      await callback(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
