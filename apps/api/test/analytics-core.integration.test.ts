import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresAnalyticsRepository } from "../src/modules/analytics/analytics-repository.js";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-service.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import {
  createPostgresAnalyticsProjectionRepository,
  processAnalyticsProjections
} from "../../worker/src/analytics-projections.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("Analytics Core against migrated Postgres", () => {
  it("rebuilds duplicate-safe typed projections, reconciles parity, and incorporates late facts", async () => {
    const databaseUrl = process.env.API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
    const databaseHost = safeDatabaseHost(databaseUrl);
    if (!databaseUrl || !["127.0.0.1", "localhost"].includes(databaseHost)) {
      throw new Error("A loopback API_INTEGRATION_DATABASE_URL is required");
    }

    const sql = createPostgresClient(databaseUrl);
    const projectionRepository = createPostgresAnalyticsProjectionRepository(databaseUrl);
    const analyticsRepository = createPostgresAnalyticsRepository(sql);
    const queryService = new AnalyticsQueryService(analyticsRepository);
    const creatorId = randomUUID();
    const contentId = randomUUID();
    const mediaAssetId = randomUUID();
    const viewerIds = Array.from({ length: 7 }, () => randomUUID());
    const jobIds: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const eventTime = `${today}T10:00:00.000Z`;
    const suffix = creatorId.replaceAll("-", "").slice(0, 12);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${creatorId}, ${creatorId}, 'active')
      `;
      for (const viewerId of viewerIds) {
        await sql`insert into users (id, supabase_user_id, state) values (${viewerId}, ${viewerId}, 'active')`;
      }
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`analytics_${suffix}`}, 'Analytics creator', 'public')
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, visibility, moderation_state,
          publish_state, published_at, created_at, updated_at
        ) values (
          ${contentId}, ${creatorId}, 'clip', 'draft', 'private', 'pending',
          'draft', null, ${eventTime}::timestamptz, ${eventTime}::timestamptz
        )
      `;
      await sql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state, duration_ms, created_at
        ) values (
          ${mediaAssetId}, ${contentId}, 'bunny', ${`analytics-${suffix}`}, 'ready', 10000, ${eventTime}::timestamptz
        )
      `;

      for (const [index, viewerId] of viewerIds.slice(0, 6).entries()) {
        const sessionId = randomUUID();
        await sql`
          insert into feed_impression_receipts (
            user_id, idempotency_key, content_item_id, created_at, expires_at
          ) values (
            ${viewerId}, ${`analytics-impression-${index}-${suffix}`}, ${contentId},
            ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '7 days'
          )
        `;
        await sql`
          insert into platform_playback_sessions (
            id, user_id, target_type, target_id, state, window_starts_at, window_ends_at,
            idempotency_key, request_hash, created_at, updated_at
          ) values (
            ${sessionId}, ${viewerId}, 'content', ${contentId}, 'closed',
            ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '1 month',
            ${`analytics-session-${index}-${suffix}`}, ${"a".repeat(64)},
            ${eventTime}::timestamptz, ${eventTime}::timestamptz
          )
        `;
        await sql`
          insert into platform_playback_heartbeats (
            session_id, sequence, reported_seconds, credited_seconds,
            idempotency_key, request_hash, created_at
          ) values (
            ${sessionId}, 1, 10, 10, ${`analytics-heartbeat-${index}-${suffix}`},
            ${"b".repeat(64)}, ${eventTime}::timestamptz
          )
        `;
        await sql`
          insert into content_reactions (
            user_id, content_item_id, reaction_key, state, last_idempotency_key,
            created_at, updated_at
          ) values (
            ${viewerId}, ${contentId}, 'like', 'active',
            ${`analytics-like-${index}-${suffix}`}, ${eventTime}::timestamptz, ${eventTime}::timestamptz
          )
        `;
      }

      const firstJobId = await enqueueBackfill(sql, today);
      jobIds.push(firstJobId);
      const firstRun = await processAnalyticsProjections({
        repository: withoutAutomaticIncremental(projectionRepository),
        now: new Date(),
        limit: 1
      });
      expect(firstRun).toMatchObject({ leased: 1, completed: 1, mismatched: 0 });

      const firstProjection = await sql<Array<{
        impression_count: string | number;
        qualified_view_count: string | number;
        completed_view_count: string | number;
        like_count: string | number;
        audience_sample_size: string | number;
      }>>`
        select impression_count, qualified_view_count, completed_view_count,
          like_count, audience_sample_size
        from analytics_creator_content_daily
        where bucket_date = ${today}::date and content_item_id = ${contentId}
      `;
      expect(Object.fromEntries(Object.entries(firstProjection[0] ?? {}).map(([key, value]) => [key, Number(value)]))).toMatchObject({
        impression_count: 6,
        qualified_view_count: 6,
        completed_view_count: 6,
        like_count: 6,
        audience_sample_size: 6
      });

      const query = await queryService.query(creatorId, {
        scope: { type: "creator" },
        metricKeys: ["creator.content.impressions", "creator.content.completion_rate"],
        window: { startDate: today, endDate: today },
        granularity: "total",
        timezone: "UTC",
        dimensions: { contentId }
      });
      expect(query?.metrics.map((metric) => metric.points[0]?.value)).toEqual([6, 1]);
      expect(query?.metrics.every((metric) => metric.points[0]?.privacyDecision === "released")).toBe(true);

      const lateViewerId = viewerIds[6] as string;
      await sql`
        insert into feed_impression_receipts (
          user_id, idempotency_key, content_item_id, created_at, expires_at
        ) values (
          ${lateViewerId}, ${`analytics-late-${suffix}`}, ${contentId},
          ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '7 days'
        )
      `;
      const secondJobId = await enqueueBackfill(sql, today);
      jobIds.push(secondJobId);
      await expect(processAnalyticsProjections({
        repository: withoutAutomaticIncremental(projectionRepository),
        now: new Date(),
        limit: 1
      })).resolves.toMatchObject({ completed: 1, mismatched: 0 });

      const lateProjection = await sql<Array<{ impression_count: string | number; row_count: string | number }>>`
        select max(impression_count) as impression_count, count(*) as row_count
        from analytics_creator_content_daily
        where bucket_date = ${today}::date and content_item_id = ${contentId}
      `;
      expect(Number(lateProjection[0]?.impression_count)).toBe(7);
      expect(Number(lateProjection[0]?.row_count)).toBe(1);
    } finally {
      await sql`delete from analytics_reconciliation_runs where job_id = any(${jobIds}::uuid[])`;
      await sql`delete from analytics_projection_watermarks where last_job_id = any(${jobIds}::uuid[])`;
      await sql`delete from analytics_projection_jobs where id = any(${jobIds}::uuid[])`;
      await sql`delete from platform_playback_heartbeats where session_id in (select id from platform_playback_sessions where user_id = any(${viewerIds}::uuid[]))`;
      await sql`delete from platform_playback_sessions where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from feed_impression_receipts where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from content_reactions where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from media_assets where id = ${mediaAssetId}`;
      await sql`delete from content_items where id = ${contentId}`;
      await sql`delete from profiles where user_id = ${creatorId}`;
      await sql`delete from users where id = any(${[creatorId, ...viewerIds]}::uuid[])`;
      await projectionRepository.close?.();
      await sql.end({ timeout: 5 });
    }
  });
});

async function enqueueBackfill(sql: ReturnType<typeof createPostgresClient>, day: string): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into analytics_projection_jobs (
      projection_key, definition_version, window_starts_on, window_ends_on,
      reason, idempotency_key, next_attempt_at
    ) values (
      'analytics_core', 1, ${day}::date, ${day}::date,
      'backfill', ${`integration:${randomUUID()}`}, now() - interval '1 second'
    ) returning id
  `;
  return rows[0]?.id as string;
}

function withoutAutomaticIncremental(repository: ReturnType<typeof createPostgresAnalyticsProjectionRepository>) {
  return { ...repository, async enqueueIncremental() {} };
}

function safeDatabaseHost(databaseUrl: string | undefined): string {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : "";
  } catch {
    return "";
  }
}
