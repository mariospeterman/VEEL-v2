import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
