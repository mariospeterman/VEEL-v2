import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_ROLLBACK_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;
const migrations = new URL("../migrations/", import.meta.url);

describeIntegration("canonical rollback SQL against migrated Postgres", () => {
  let sql: postgres.Sql | undefined;

  beforeAll(() => {
    const databaseUrl = process.env.ROLLBACK_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error("ROLLBACK_INTEGRATION_DATABASE_URL is required");
    const host = new URL(databaseUrl).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("Rollback integration tests require an isolated loopback database");
    }
    sql = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("removes only the guarded Realtime publication members and reapplies them", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0039_realtime_projection_publication.down.sql");
    const up = migration("0039_realtime_projection_publication.sql");

    const publication = await sql<{ puballtables: boolean }[]>`
      select puballtables from pg_publication where pubname = 'supabase_realtime'
    `;
    expect(publication).toEqual([{ puballtables: false }]);

    await sql.unsafe(down);
    expect(await realtimeProjectionCount(sql)).toBe(0);
    await sql.unsafe(down);
    expect(await realtimeProjectionCount(sql)).toBe(0);

    await sql.unsafe(up);
    expect(await realtimeProjectionCount(sql)).toBe(3);
  });

  it("rolls Moment schema down and reapplies it only while no Moment evidence exists", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0117_moments_and_scheduled_publication.down.sql");
    const up = migration("0117_moments_and_scheduled_publication.sql");
    const moments = await sql<{ count: number }[]>`
      select count(*)::integer as count from content_items where distribution_mode = 'moment'
    `;
    expect(moments[0]?.count).toBe(0);

    await sql.begin(async (transaction) => {
      await transaction.unsafe(down);
    });
    expect(await columnExists(sql, "content_items", "distribution_mode")).toBe(false);
    expect(await relationExists(sql, "content_publication_jobs")).toBe(false);

    await sql.begin(async (transaction) => {
      await transaction.unsafe(up);
    });
    await expectMomentSchemaPresent(sql);
  });

  it("aborts a populated Moment rollback without changing rows or expiry authority", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0117_moments_and_scheduled_publication.down.sql");
    const userId = randomUUID();
    const contentId = randomUUID();

    await sql`insert into users (id, supabase_user_id, state) values (${userId}, ${userId}, 'active')`;
    await sql`
      insert into content_items (
        id, creator_user_id, media_type, state, publish_state, caption,
        visibility, nsfw_label, moderation_state, distribution_mode, expires_at
      ) values (
        ${contentId}, ${userId}, 'image', 'draft', 'draft', 'Rollback privacy fixture',
        'private', 'none', 'pending', 'moment', now() + interval '1 hour'
      )
    `;

    try {
      let rollbackError: unknown;
      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe(down);
        });
      } catch (error) {
        rollbackError = error;
      }

      expect(rollbackError).toMatchObject({ code: "55000" });
      const retained = await sql<{ distribution_mode: string; expires_at: Date | null }[]>`
        select distribution_mode, expires_at from content_items where id = ${contentId}
      `;
      expect(retained[0]?.distribution_mode).toBe("moment");
      expect(retained[0]?.expires_at).toBeInstanceOf(Date);
      await expectMomentSchemaPresent(sql);
    } finally {
      await sql`delete from content_items where id = ${contentId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});

function migration(fileName: string): string {
  return readFileSync(new URL(fileName, migrations), "utf8");
}

async function realtimeProjectionCount(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('conversation_members', 'messages', 'notifications')
  `;
  return rows[0]?.count ?? -1;
}

async function columnExists(sql: postgres.Sql, table: string, column: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    ) as present
  `;
  return rows[0]?.present ?? false;
}

async function relationExists(sql: postgres.Sql, relation: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select to_regclass(${'public.' + relation}) is not null as present
  `;
  return rows[0]?.present ?? false;
}

async function expectMomentSchemaPresent(sql: postgres.Sql): Promise<void> {
  expect(await columnExists(sql, "content_items", "distribution_mode")).toBe(true);
  expect(await columnExists(sql, "content_items", "expires_at")).toBe(true);
  expect(await columnExists(sql, "content_items", "scheduled_for")).toBe(true);
  expect(await relationExists(sql, "content_publication_jobs")).toBe(true);

  const rows = await sql<{ function_present: boolean; trigger_present: boolean }[]>`
    select
      to_regprocedure('private.eligible_content(uuid,text)') is not null as function_present,
      exists (
        select 1 from pg_trigger
        where tgname = 'content_items_sync_publication_job' and not tgisinternal
      ) as trigger_present
  `;
  expect(rows[0]).toEqual({ function_present: true, trigger_present: true });
}
