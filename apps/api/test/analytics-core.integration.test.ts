import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresAnalyticsRepository } from "../src/modules/analytics/analytics-repository.js";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-service.js";
import { createPostgresAdminRepository } from "../src/modules/admin/admin-repository.js";
import { rolePermissions, staffRoles, type StaffRole } from "../src/modules/admin/admin-permissions.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import {
  createPostgresAnalyticsProjectionRepository,
  processAnalyticsProjections
} from "../../worker/src/analytics-projections.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("Analytics Core against migrated Postgres", () => {
  it("rebuilds duplicate-safe typed projections, reconciles parity, and incorporates late facts", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();

    const sql = createPostgresClient(databaseUrl);
    const projectionRepository = createPostgresAnalyticsProjectionRepository(databaseUrl);
    const analyticsRepository = createPostgresAnalyticsRepository(sql);
    const queryService = new AnalyticsQueryService(analyticsRepository);
    const creatorId = randomUUID();
    const contentId = randomUUID();
    const mediaAssetId = randomUUID();
    const replacementMediaAssetId = randomUUID();
    const secondContentId = randomUUID();
    const secondMediaAssetId = randomUUID();
    const staffMembershipId = randomUUID();
    const organizationId = randomUUID();
    const organizationMembershipId = randomUUID();
    const organizationWaiverId = randomUUID();
    const providerEventId = randomUUID();
    const instrumentationJourneyId = randomUUID();
    const viewerIds = Array.from({ length: 7 }, () => randomUUID());
    const primaryViewerId = viewerIds[0] as string;
    const jobIds: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const eventTime = `${today}T10:00:00.000Z`;
    const suffix = creatorId.replaceAll("-", "").slice(0, 12);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${creatorId}, ${creatorId}, 'active')
      `;
      const instrumentationEvent = {
        journeyId: instrumentationJourneyId,
        userId: creatorId,
        eventKey: "login_opened" as const,
        source: "browser" as const,
        idempotencyKey: "login-opened",
        occurredAt: new Date()
      };
      await analyticsRepository.recordOnboardingEvent(instrumentationEvent);
      await analyticsRepository.recordOnboardingEvent(instrumentationEvent);
      const instrumentationRows = await sql<Array<{ count: string | number }>>`
        select count(*) as count from analytics_onboarding_journey_events
        where journey_id = ${instrumentationJourneyId}::uuid
      `;
      expect(Number(instrumentationRows[0]?.count)).toBe(1);
      for (const viewerId of viewerIds) {
        await sql`insert into users (id, supabase_user_id, state) values (${viewerId}, ${viewerId}, 'active')`;
      }
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`analytics_${suffix}`}, 'Analytics creator', 'public')
      `;
      await sql`
        insert into staff_memberships (id, user_id, role, state)
        values (${staffMembershipId}, ${creatorId}, 'ops', 'active')
      `;
      await sql`
        insert into organizations (id, name, state, kyb_state)
        values (${organizationId}, ${`Analytics organization ${suffix}`}, 'active', 'verified')
      `;
      await sql`
        insert into organization_memberships (
          id, organization_id, user_id, role, state, joined_at
        ) values (
          ${organizationMembershipId}, ${organizationId}, ${creatorId}, 'owner', 'active', now()
        )
      `;
      await sql`
        insert into tier_waivers (
          id, subject_type, subject_id, tier_key, state, starts_at
        ) values (
          ${organizationWaiverId}, 'organization', ${organizationId}, 'enterprise', 'active', now()
        )
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
        ) values
          (${mediaAssetId}, ${contentId}, 'bunny', ${`analytics-${suffix}`}, 'ready', 10000, ${eventTime}::timestamptz),
          (${replacementMediaAssetId}, ${contentId}, 'bunny', ${`analytics-replacement-${suffix}`}, 'ready', 1000, ${eventTime}::timestamptz)
      `;
      await sql`update content_items set release_media_asset_id = ${mediaAssetId} where id = ${contentId}`;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, visibility, moderation_state,
          publish_state, published_at, created_at, updated_at
        ) values (
          ${secondContentId}, ${creatorId}, 'clip', 'draft', 'private', 'pending',
          'draft', null, ${eventTime}::timestamptz, ${eventTime}::timestamptz
        )
      `;
      await sql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state, duration_ms, created_at
        ) values (
          ${secondMediaAssetId}, ${secondContentId}, 'bunny', ${`analytics-second-${suffix}`},
          'ready', 10000, ${eventTime}::timestamptz
        )
      `;
      await sql`update content_items set release_media_asset_id = ${secondMediaAssetId} where id = ${secondContentId}`;

      for (const [index, viewerId] of viewerIds.slice(0, 6).entries()) {
        const sessionId = randomUUID();
        const journeyId = randomUUID();
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
            id, user_id, target_type, target_id, media_asset_id, state, window_starts_at, window_ends_at,
            idempotency_key, request_hash, created_at, updated_at
          ) values (
            ${sessionId}, ${viewerId}, 'content', ${contentId}, ${mediaAssetId}, 'closed',
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
        await sql`
          insert into analytics_profile_open_receipts (
            actor_user_id, profile_user_id, idempotency_key, created_at, expires_at
          ) values (
            ${viewerId}, ${creatorId}, ${`analytics-profile-${index}-${suffix}`},
            ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '30 days'
          )
        `;
        await sql`
          insert into analytics_offer_impression_receipts (
            user_id, creator_user_id, product_type, currency, target_id,
            idempotency_key, created_at, expires_at
          ) values (
            ${viewerId}, ${creatorId}, 'support', 'USDC', ${contentId},
            ${`analytics-offer-${index}-${suffix}`}, ${eventTime}::timestamptz,
            ${eventTime}::timestamptz + interval '30 days'
          )
        `;
        await sql`
          insert into analytics_onboarding_journey_events (
            journey_id, user_id, event_key, source, idempotency_key, occurred_at, expires_at
          ) values
            (${journeyId}, ${viewerId}, 'onboarding_opened', 'browser', 'opened',
              ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '90 days'),
            (${journeyId}, ${viewerId}, 'protected_app_entered', 'server', 'entered',
              ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '90 days')
        `;
      }
      for (const [targetId, targetAssetId, key] of [
        [contentId, mediaAssetId, "repeat"],
        [secondContentId, secondMediaAssetId, "distinct"]
      ] as const) {
        const sessionId = randomUUID();
        await sql`
          insert into platform_playback_sessions (
            id, user_id, target_type, target_id, media_asset_id, state,
            window_starts_at, window_ends_at, idempotency_key, request_hash,
            created_at, updated_at
          ) values (
            ${sessionId}, ${primaryViewerId}, 'content', ${targetId}, ${targetAssetId}, 'closed',
            ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '1 month',
            ${`analytics-session-${key}-${suffix}`}, ${"c".repeat(64)},
            ${eventTime}::timestamptz, ${eventTime}::timestamptz
          )
        `;
        await sql`
          insert into platform_playback_heartbeats (
            session_id, sequence, reported_seconds, credited_seconds,
            idempotency_key, request_hash, created_at
          ) values (
            ${sessionId}, 1, 10, 10, ${`analytics-heartbeat-${key}-${suffix}`},
            ${"d".repeat(64)}, ${eventTime}::timestamptz
          )
        `;
      }
      await sql`
        insert into provider_events (
          id, provider, provider_event_id, event_type, normalized_state, received_at
        ) values (
          ${providerEventId}, 'analytics_fixture', ${`failure-${suffix}`},
          'fixture.failed', 'failed', ${eventTime}::timestamptz
        )
      `;

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
        credited_watch_seconds: string | number;
        completed_view_count: string | number;
        like_count: string | number;
        audience_sample_size: string | number;
      }>>`
        select impression_count, qualified_view_count, credited_watch_seconds, completed_view_count,
          like_count, audience_sample_size
        from analytics_creator_content_daily
        where bucket_date = ${today}::date and content_item_id = ${contentId}
      `;
      expect(Object.fromEntries(Object.entries(firstProjection[0] ?? {}).map(([key, value]) => [key, Number(value)]))).toMatchObject({
        impression_count: 6,
        qualified_view_count: 7,
        credited_watch_seconds: 70,
        completed_view_count: 7,
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
      expect(query?.metrics.map((metric) => metric.points[0]?.value)).toEqual(["6", 1]);
      expect(query?.metrics.every((metric) => metric.points[0]?.privacyDecision === "released")).toBe(true);

      const socialQuery = await queryService.query(creatorId, {
        scope: { type: "creator" },
        metricKeys: ["creator.social.profile_opens"],
        window: { startDate: today, endDate: today },
        granularity: "total",
        timezone: "UTC"
      });
      const offerQuery = await queryService.query(creatorId, {
        scope: { type: "creator" },
        metricKeys: ["creator.commerce.offer_impressions"],
        window: { startDate: today, endDate: today },
        granularity: "total",
        timezone: "UTC",
        dimensions: { currency: "USDC", productType: "support" }
      });
      expect(socialQuery?.metrics[0]?.points[0]?.value).toBe("6");
      expect(offerQuery?.metrics[0]?.points[0]?.value).toBe("6");
      expect(socialQuery?.metrics[0]?.points[0]?.privacyDecision).toBe("released");
      expect(offerQuery?.metrics[0]?.points[0]?.privacyDecision).toBe("released");

      const viewerQuery = await queryService.query(primaryViewerId, {
        scope: { type: "viewer" },
        metricKeys: [
          "viewer.feed.impressions",
          "viewer.content.qualified_views",
          "viewer.content.completion_rate",
          "viewer.content.replays"
        ],
        window: { startDate: today, endDate: today },
        granularity: "total",
        timezone: "UTC"
      });
      expect(viewerQuery?.metrics.map((metric) => metric.points[0]?.value)).toEqual(["1", "3", 1, "1"]);

      const platformQuery = await queryService.query(creatorId, {
        scope: { type: "platform", purposeCode: "analytics.integration" },
        metricKeys: [
          "platform.onboarding.completed",
          "platform.onboarding.completion_rate",
          "platform.operations.provider_failures"
        ],
        window: { startDate: today, endDate: today },
        granularity: "total",
        timezone: "UTC"
      });
      expect(platformQuery?.metrics.map((metric) => metric.points[0]?.value)).toEqual(["6", 1, "1"]);
      expect(platformQuery?.metrics.every((metric) => metric.points[0]?.privacyDecision === "released")).toBe(true);
      const platformAuditRows = await sql<Array<{ metadata: { purposeCode?: string; metricKeys?: string[] } }>>`
        select metadata from audit_events
        where actor_user_id = ${creatorId}::uuid
          and action = 'analytics.platform_query'
        order by created_at desc
        limit 1
      `;
      expect(platformAuditRows[0]?.metadata).toMatchObject({
        purposeCode: "analytics.integration",
        metricKeys: [
          "platform.onboarding.completed",
          "platform.onboarding.completion_rate",
          "platform.operations.provider_failures"
        ]
      });

      await expect(analyticsRepository.authorizeScope(creatorId, {
        type: "organization",
        organizationId
      })).resolves.toEqual({ type: "organization", organizationId });
      await expect(analyticsRepository.authorizeScope(viewerIds[0] as string, {
        type: "organization",
        organizationId
      })).resolves.toBeNull();

      const lateViewerId = viewerIds[6] as string;
      await sql`
        insert into feed_impression_receipts (
          user_id, idempotency_key, content_item_id, created_at, expires_at
        ) values (
          ${lateViewerId}, ${`analytics-late-${suffix}`}, ${contentId},
          ${eventTime}::timestamptz, ${eventTime}::timestamptz + interval '7 days'
        )
      `;
      const secondJobId = await enqueueExpiredLeaseBackfill(sql, today);
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
      const restartedJob = await sql<Array<{ attempt_count: number; state: string }>>`
        select attempt_count, state from analytics_projection_jobs where id = ${secondJobId}
      `;
      expect(restartedJob[0]).toMatchObject({ attempt_count: 2, state: "completed" });
    } finally {
      await sql`delete from analytics_reconciliation_runs where job_id = any(${jobIds}::uuid[])`;
      await sql`delete from analytics_projection_watermarks where last_job_id = any(${jobIds}::uuid[])`;
      await sql`delete from analytics_projection_jobs where id = any(${jobIds}::uuid[])`;
      await sql`delete from analytics_onboarding_journey_events where journey_id = ${instrumentationJourneyId}::uuid`;
      await sql`delete from analytics_onboarding_journey_events where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from analytics_offer_impression_receipts where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from analytics_profile_open_receipts where actor_user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from platform_playback_heartbeats where session_id in (select id from platform_playback_sessions where user_id = any(${viewerIds}::uuid[]))`;
      await sql`delete from platform_playback_sessions where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from feed_impression_receipts where user_id = any(${viewerIds}::uuid[])`;
      await sql`delete from content_reactions where user_id = any(${viewerIds}::uuid[])`;
      await sql`update content_items set release_media_asset_id = null where id = any(${[contentId, secondContentId]}::uuid[])`;
      await sql`delete from media_assets where id = any(${[mediaAssetId, replacementMediaAssetId, secondMediaAssetId]}::uuid[])`;
      await sql`delete from content_items where id = any(${[contentId, secondContentId]}::uuid[])`;
      await sql`delete from provider_events where id = ${providerEventId}`;
      await sql`delete from audit_events where actor_user_id = ${creatorId}::uuid`;
      await sql`delete from staff_memberships where id = ${staffMembershipId}`;
      await sql`delete from tier_waivers where id = ${organizationWaiverId}`;
      await sql`delete from organization_memberships where id = ${organizationMembershipId}`;
      await sql`delete from organizations where id = ${organizationId}`;
      await sql`delete from profiles where user_id = ${creatorId}`;
      await sql`delete from users where id = any(${[creatorId, ...viewerIds]}::uuid[])`;
      await projectionRepository.close?.();
      await sql.end({ timeout: 5 });
    }
  });

  it("purges expired raw telemetry without erasing aggregates and dead-letters exhausted leases", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const projectionRepository = createPostgresAnalyticsProjectionRepository(databaseUrl);
    const actorId = randomUUID();
    const profileId = randomUUID();
    const journeyId = randomUUID();
    const historicalJobId = randomUUID();
    const exhaustedJobId = randomUUID();
    const historicalDay = "1999-01-02";
    const now = new Date("2026-11-04T15:00:00.000Z");

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorId}, ${actorId}, 'active'),
          (${profileId}, ${profileId}, 'active')
      `;
      await sql`
        insert into analytics_creator_daily (
          bucket_date, creator_user_id, profile_open_count
        ) values (${historicalDay}::date, ${profileId}, 1)
      `;
      await sql`
        insert into analytics_profile_open_receipts (
          actor_user_id, profile_user_id, idempotency_key, created_at, expires_at
        ) values (
          ${actorId}, ${profileId}, 'expired-profile-open',
          ${historicalDay}::date, ${historicalDay}::date + interval '30 days'
        )
      `;
      await sql`
        insert into analytics_onboarding_journey_events (
          journey_id, user_id, event_key, source, idempotency_key, occurred_at, expires_at
        ) values (
          ${journeyId}, ${actorId}, 'landing_viewed', 'browser', 'expired-onboarding',
          ${historicalDay}::date, ${historicalDay}::date + interval '90 days'
        )
      `;

      await expect(projectionRepository.purgeExpiredRawFacts?.({
        now,
        limitPerSource: 10
      })).resolves.toMatchObject({
        profile_open_receipts: 1,
        onboarding_journey_events: 1
      });

      await sql`
        insert into analytics_projection_jobs (
          id, projection_key, definition_version, window_starts_on, window_ends_on,
          reason, idempotency_key, next_attempt_at
        ) values (
          ${historicalJobId}, 'analytics_core', 1, ${historicalDay}::date, ${historicalDay}::date,
          'backfill', ${`retention-boundary:${historicalJobId}`}, ${now}::timestamptz
        )
      `;
      await sql`
        insert into analytics_projection_jobs (
          id, projection_key, definition_version, window_starts_on, window_ends_on,
          reason, state, attempt_count, max_attempts, next_attempt_at, leased_until,
          lease_token, idempotency_key
        ) values (
          ${exhaustedJobId}, 'analytics_core', 1, '2099-01-01', '2099-01-01',
          'backfill', 'leased', 5, 5, ${now}::timestamptz,
          ${now}::timestamptz - interval '1 minute', ${randomUUID()},
          ${`exhausted-lease:${exhaustedJobId}`}
        )
      `;

      await expect(processAnalyticsProjections({
        repository: withoutAutomaticIncremental(projectionRepository),
        now,
        limit: 10
      })).resolves.toMatchObject({ leased: 1, retrying: 1, deadLettered: 0 });

      const jobs = await sql<Array<{ id: string; state: string; attempt_count: number; last_error_code: string | null }>>`
        select id, state, attempt_count, last_error_code
        from analytics_projection_jobs
        where id = any(${[historicalJobId, exhaustedJobId]}::uuid[])
        order by id
      `;
      expect(jobs.find((job) => job.id === exhaustedJobId)).toMatchObject({
        state: "dead_letter",
        attempt_count: 5,
        last_error_code: "analytics_projection_attempts_exhausted"
      });
      expect(jobs.find((job) => job.id === historicalJobId)).toMatchObject({
        state: "retry",
        attempt_count: 1,
        last_error_code: "analytics_projection_failed"
      });
      const retained = await sql<Array<{ profile_open_count: string | number }>>`
        select profile_open_count
        from analytics_creator_daily
        where bucket_date = ${historicalDay}::date and creator_user_id = ${profileId}
      `;
      expect(Number(retained[0]?.profile_open_count)).toBe(1);
    } finally {
      await sql`delete from analytics_projection_jobs where id = any(${[historicalJobId, exhaustedJobId]}::uuid[])`;
      await sql`delete from analytics_creator_daily where bucket_date = ${historicalDay}::date and creator_user_id = ${profileId}`;
      await sql`delete from analytics_onboarding_journey_events where journey_id = ${journeyId}`;
      await sql`delete from analytics_profile_open_receipts where actor_user_id = ${actorId}`;
      await sql`
        delete from analytics_raw_retention_boundaries
        where unavailable_through = ${historicalDay}::date
          and source_key in ('profile_open_receipts', 'onboarding_journey_events')
      `;
      await sql`delete from users where id = any(${[actorId, profileId]}::uuid[])`;
      await projectionRepository.close?.();
      await sql.end({ timeout: 5 });
    }
  });

  it("matches canonical analytics-read permission semantics for every staff role", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const analyticsRepository = createPostgresAnalyticsRepository(sql);
    const adminRepository = createPostgresAdminRepository(sql);
    const identities = new Map<StaffRole, { userId: string; membershipId: string }>(
      staffRoles.map((role) => [role, { userId: randomUUID(), membershipId: randomUUID() }])
    );
    const explicitPermissionId = randomUUID();
    const scope = { type: "platform", purposeCode: "analytics.role-proof" } as const;

    try {
      for (const [role, identity] of identities) {
        await sql`
          insert into users (id, supabase_user_id, state)
          values (${identity.userId}::uuid, ${identity.userId}::uuid, 'active')
        `;
        await sql`
          insert into staff_memberships (id, user_id, role, state)
          values (${identity.membershipId}::uuid, ${identity.userId}::uuid, ${role}, 'active')
        `;
      }

      for (const [role, identity] of identities) {
        const expected = rolePermissions[role].includes("admin.analytics.read");
        expect(
          await adminRepository.hasAdminPermission(identity.userId, "admin.analytics.read"),
          `${role} admin permission`
        ).toBe(expected);
        expect(
          await analyticsRepository.authorizeScope(identity.userId, scope),
          `${role} analytics scope`
        ).toEqual(expected ? scope : null);
      }

      const support = identities.get("support") as { userId: string; membershipId: string };
      await sql`
        insert into staff_permissions (id, user_id, permission_key, scope)
        values (${explicitPermissionId}::uuid, ${support.userId}::uuid, 'admin.analytics.read', 'global')
      `;
      await expect(adminRepository.hasAdminPermission(support.userId, "admin.analytics.read")).resolves.toBe(true);
      await expect(analyticsRepository.authorizeScope(support.userId, scope)).resolves.toEqual(scope);
      await sql`update staff_permissions set revoked_at = now() where id = ${explicitPermissionId}::uuid`;
      await expect(adminRepository.hasAdminPermission(support.userId, "admin.analytics.read")).resolves.toBe(false);
      await expect(analyticsRepository.authorizeScope(support.userId, scope)).resolves.toBeNull();

      const finance = identities.get("finance") as { userId: string; membershipId: string };
      await sql`update staff_memberships set state = 'suspended' where id = ${finance.membershipId}::uuid`;
      await expect(analyticsRepository.authorizeScope(finance.userId, scope)).resolves.toBeNull();

      const owner = identities.get("owner") as { userId: string; membershipId: string };
      await sql`update users set state = 'suspended' where id = ${owner.userId}::uuid`;
      await expect(analyticsRepository.authorizeScope(owner.userId, scope)).resolves.toBeNull();
    } finally {
      const userIds = [...identities.values()].map((identity) => identity.userId);
      await sql`delete from audit_events where actor_user_id = any(${userIds}::uuid[])`;
      await sql`delete from staff_permissions where user_id = any(${userIds}::uuid[])`;
      await sql`delete from staff_memberships where user_id = any(${userIds}::uuid[])`;
      await sql`delete from users where id = any(${userIds}::uuid[])`;
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

async function enqueueExpiredLeaseBackfill(
  sql: ReturnType<typeof createPostgresClient>,
  day: string
): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into analytics_projection_jobs (
      projection_key, definition_version, window_starts_on, window_ends_on,
      reason, state, attempt_count, next_attempt_at, leased_until, lease_token,
      idempotency_key
    ) values (
      'analytics_core', 1, ${day}::date, ${day}::date,
      'backfill', 'leased', 1, now() - interval '10 minutes',
      now() - interval '5 minutes', ${randomUUID()}::uuid,
      ${`integration-restart:${randomUUID()}`}
    ) returning id
  `;
  return rows[0]?.id as string;
}

function withoutAutomaticIncremental(repository: ReturnType<typeof createPostgresAnalyticsProjectionRepository>) {
  return { ...repository, async enqueueIncremental() {} };
}
