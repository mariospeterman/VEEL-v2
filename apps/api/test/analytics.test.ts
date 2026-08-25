import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import { analyticsMetricRegistry } from "../src/modules/analytics/metric-registry.js";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-service.js";
import { AnalyticsIdempotencyConflictError } from "../src/modules/analytics/analytics-errors.js";
import type {
  AnalyticsProjectionHealth,
  AnalyticsRawPoint,
  AnalyticsRepository,
  AnalyticsScope
} from "../src/modules/analytics/types.js";
import type { AdminRepository } from "../src/modules/admin/types.js";

const actorUserId = "00000000-0000-4000-8000-000000000001";

describe("Analytics Core", () => {
  it("keeps every metric definition explicitly versioned with closed dimensions", () => {
    expect(analyticsMetricRegistry.size).toBeGreaterThanOrEqual(45);
    for (const definition of analyticsMetricRegistry.values()) {
      expect(definition.definitionVersion).toBe(1);
      expect(definition.minimumCohortSize).toBeGreaterThan(0);
      expect(definition.dimensions.every((dimension) => ["contentId", "mediaType", "currency", "productType", "creatorUserId", "onboardingEvent", "cohortStartDate"].includes(dimension))).toBe(true);
    }
  });

  it("records only typed, bounded onboarding events and safely deduplicates retries", async () => {
    const recorded: Array<{ journeyId: string; eventKey: string; idempotencyKey: string }> = [];
    const app = await analyticsApp(repositoryFixture({
      async recordOnboardingEvent(input) { recorded.push(input); }
    }));
    const journeyId = "00000000-0000-4000-8000-000000000010";
    const payload = {
      journeyId,
      eventKey: "landing_cta_clicked",
      idempotencyKey: "landing-cta-clicked",
      occurredAt: new Date().toISOString()
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/onboarding-events",
      headers: { "idempotency-key": payload.idempotencyKey },
      payload
    });
    expect(response.statusCode).toBe(202);
    expect(recorded).toMatchObject([{ journeyId, eventKey: "landing_cta_clicked", idempotencyKey: "landing-cta-clicked" }]);

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/analytics/onboarding-events",
      headers: { "idempotency-key": payload.idempotencyKey },
      payload: { ...payload, eventKey: "email_captured" }
    });
    expect(unknown.statusCode).toBe(400);
    expect(recorded).toHaveLength(1);
    await app.close();
  });

  it("suppresses a small audience without leaking numerator or denominator", async () => {
    const suppressions: string[] = [];
    const app = await analyticsApp(repositoryFixture({
      async queryMetric() {
        return [{ bucketDate: null, value: 3, numerator: "3", denominator: "4", sampleSize: "4" }];
      },
      async recordSuppression(input) { suppressions.push(input.metricKey); }
    }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.content.completion_rate"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().metrics[0].points[0]).toEqual({
      bucketDate: null,
      value: null,
      numerator: null,
      denominator: null,
      sampleSize: "4",
      privacyDecision: "suppressed_minimum_cohort"
    });
    expect(suppressions).toEqual(["creator.content.completion_rate"]);
    await app.close();
  });

  it("returns deterministic comparison insight and explicit freshness", async () => {
    let call = 0;
    const app = await analyticsApp(repositoryFixture({
      async queryMetric(): Promise<AnalyticsRawPoint[]> {
        call += 1;
        return [{ bucketDate: null, value: call === 1 ? "12" : "8", numerator: null, denominator: null, sampleSize: "12" }];
      }
    }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.engagement.saves"],
        window: { startDate: "2026-08-08", endDate: "2026-08-14" },
        comparisonWindow: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      freshness: "fresh",
      metrics: [{ comparisonValue: "8", deltaPercent: 50 }],
      insights: [{ metricKey: "creator.engagement.saves", confidence: "high" }]
    });
    await app.close();
  });

  it("uses the strictest requested freshness target and rejects mismatched definitions", async () => {
    const now = new Date("2026-08-23T12:02:00.000Z");
    const staleByLag = new AnalyticsQueryService(repositoryFixture({
      async getWatermark() {
        return {
          definitionVersion: 1,
          dataThrough: new Date("2026-08-23T12:00:30.000Z"),
          state: "healthy"
        };
      }
    }));
    await expect(staleByLag.query(actorUserId, {
      scope: { type: "creator" },
      metricKeys: ["creator.content.impressions", "creator.content.published"],
      window: { startDate: "2026-08-23", endDate: "2026-08-23" },
      granularity: "total",
      timezone: "UTC"
    }, now)).resolves.toMatchObject({ freshness: "stale" });

    const staleByVersion = new AnalyticsQueryService(repositoryFixture({
      async getWatermark() {
        return {
          definitionVersion: 2,
          dataThrough: new Date("2026-08-23T12:01:50.000Z"),
          state: "healthy"
        };
      }
    }));
    await expect(staleByVersion.query(actorUserId, {
      scope: { type: "creator" },
      metricKeys: ["creator.content.published"],
      window: { startDate: "2026-08-23", endDate: "2026-08-23" },
      granularity: "total",
      timezone: "UTC"
    }, now)).resolves.toMatchObject({ freshness: "stale" });
  });

  it("aggregates daily ratios from their released numerator and denominator", async () => {
    let call = 0;
    const app = await analyticsApp(repositoryFixture({
      async queryMetric(): Promise<AnalyticsRawPoint[]> {
        call += 1;
        return call === 1
          ? [
              { bucketDate: "2026-08-08", value: 0.5, numerator: "1", denominator: "2", sampleSize: "5" },
              { bucketDate: "2026-08-09", value: 1, numerator: "8", denominator: "8", sampleSize: "8" }
            ]
          : [{ bucketDate: null, value: 0.5, numerator: "5", denominator: "10", sampleSize: "10" }];
      }
    }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.content.completion_rate"],
        window: { startDate: "2026-08-08", endDate: "2026-08-09" },
        comparisonWindow: { startDate: "2026-08-01", endDate: "2026-08-02" },
        granularity: "day",
        timezone: "UTC"
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().metrics[0]).toMatchObject({ comparisonValue: 0.5, deltaPercent: 80 });
    await app.close();
  });

  it("requires explicit native currency and rejects cross-creator scope", async () => {
    const app = await analyticsApp(repositoryFixture({
      async authorizeScope(_actor, scope) {
        return scope.type === "creator" && scope.creatorUserId && scope.creatorUserId !== actorUserId ? null : { type: "creator", creatorUserId: actorUserId };
      }
    }));
    const missingCurrency = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.commerce.confirmed_gross_minor"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(missingCurrency.statusCode).toBe(400);

    const crossCreator = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator", creatorUserId: "00000000-0000-4000-8000-000000000099" },
        metricKeys: ["creator.content.published"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(crossCreator.statusCode).toBe(403);
    await app.close();
  });

  it("rejects calendar-invalid windows before they reach Postgres", async () => {
    const app = await analyticsApp(repositoryFixture());
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.content.published"],
        window: { startDate: "2026-02-28", endDate: "2026-02-31" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("preserves counts above JavaScript's safe integer limit as decimal strings", async () => {
    const unsafeInteger = "9007199254740993";
    const app = await analyticsApp(repositoryFixture({
      async queryMetric() {
        return [{ bucketDate: null, value: unsafeInteger, numerator: null, denominator: null, sampleSize: unsafeInteger }];
      }
    }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "creator" },
        metricKeys: ["creator.commerce.earnings_minor"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC",
        dimensions: { currency: "USDC" }
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().metrics[0].points[0]).toMatchObject({
      value: unsafeInteger,
      sampleSize: unsafeInteger,
      privacyDecision: "released"
    });
    await app.close();
  });

  it("denies another viewer's personal metrics and platform metrics without staff authorization", async () => {
    const app = await analyticsApp(repositoryFixture({
      async authorizeScope(_actor, scope) {
        if (scope.type === "viewer" && scope.userId && scope.userId !== actorUserId) return null;
        if (scope.type === "platform") return null;
        return scope.type === "viewer" ? { type: "viewer", userId: actorUserId } : scope;
      }
    }));
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "viewer", userId: "00000000-0000-4000-8000-000000000099" },
        metricKeys: ["viewer.feed.impressions"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(viewerResponse.statusCode).toBe(403);

    const platformResponse = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: "Bearer valid" },
      payload: {
        scope: { type: "platform", purposeCode: "operations.review" },
        metricKeys: ["platform.operations.provider_failures"],
        window: { startDate: "2026-08-01", endDate: "2026-08-07" },
        granularity: "total",
        timezone: "UTC"
      }
    });
    expect(platformResponse.statusCode).toBe(403);
    await app.close();
  });

  it("queues bounded staff backfills with idempotency and maps replay conflicts", async () => {
    const enqueued: Array<{ idempotencyKey: string; requestHash: string; reason: string }> = [];
    const app = await analyticsApp(repositoryFixture({
      async enqueueProjectionJob(input) {
        enqueued.push(input);
        return {
          id: "00000000-0000-4000-8000-000000000099",
          jobType: input.jobType,
          state: "queued",
          window: input.window,
          createdAt: "2026-08-23T12:00:00.000Z"
        };
      }
    }), true);
    const payload = {
      jobType: "backfill",
      window: { startDate: "2026-08-01", endDate: "2026-08-07" },
      reason: "Rebuild a bounded late-fact window"
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/analytics/jobs",
      headers: { authorization: "Bearer valid", "idempotency-key": "analytics-backfill-1" },
      payload
    });
    expect(response.statusCode).toBe(202);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ idempotencyKey: "analytics-backfill-1", reason: payload.reason });
    expect(enqueued[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    await app.close();

    const conflictApp = await analyticsApp(repositoryFixture({
      async enqueueProjectionJob() { throw new AnalyticsIdempotencyConflictError(); }
    }), true);
    const conflict = await conflictApp.inject({
      method: "POST",
      url: "/v1/admin/analytics/jobs",
      headers: { authorization: "Bearer valid", "idempotency-key": "analytics-backfill-1" },
      payload
    });
    expect(conflict.statusCode).toBe(409);
    await conflictApp.close();
  });

  it("exposes projection health only through staff authorization", async () => {
    const health: AnalyticsProjectionHealth = {
      projectionKey: "analytics_core",
      definitionVersion: 1,
      state: "reconciling",
      dataThrough: "2026-08-23T12:00:00.000Z",
      lagSeconds: 120,
      queuedJobCount: 1,
      leasedJobCount: 0,
      retryJobCount: 0,
      deadLetterJobCount: 0,
      latestReconciliationState: "mismatch",
      latestReconciliationVariance: 1,
      suppressionCountToday: 2
    };
    const app = await analyticsApp(repositoryFixture({ async getProjectionHealth() { return health; } }), true);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/analytics/health",
      headers: { authorization: "Bearer valid" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(health);
    await app.close();
  });
});

async function analyticsApp(repository: AnalyticsRepository, admin = false) {
  return buildApi({
    authVerifier: {
      async verifyToken() {
        return {
          userId: actorUserId,
          supabaseUserId: actorUserId,
          sessionId: "00000000-0000-4000-8000-000000000002",
          authenticatedAt: new Date(),
          authenticationMethod: "wallet" as const
        };
      }
    },
    analyticsRepository: repository,
    adminRepository: {
      async hasAdminAccess() { return admin; },
      async hasAdminPermission() { return admin; },
      async getStaffAccess() {
        return admin
          ? { userId: actorUserId, roles: ["owner"], permissions: ["admin.analytics.read", "admin.analytics.recompute"] }
          : null;
      }
    } as unknown as AdminRepository
  });
}

function repositoryFixture(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  return {
    async recordOnboardingEvent() {},
    async authorizeScope(_actorUserId, scope): Promise<AnalyticsScope> {
      return scope.type === "creator"
        ? { type: "creator", creatorUserId: scope.creatorUserId ?? actorUserId }
        : scope;
    },
    async queryMetric() { return [{ bucketDate: null, value: "10", numerator: null, denominator: null, sampleSize: "10" }]; },
    async getWatermark() { return { definitionVersion: 1, dataThrough: new Date(Date.now() - 10_000), state: "healthy" }; },
    async recordSuppression() {},
    async getProjectionHealth() {
      return {
        projectionKey: "analytics_core", definitionVersion: 1, state: "healthy",
        dataThrough: new Date().toISOString(), lagSeconds: 0, queuedJobCount: 0,
        leasedJobCount: 0, retryJobCount: 0, deadLetterJobCount: 0,
        latestReconciliationState: "matched", latestReconciliationVariance: 0,
        suppressionCountToday: 0
      };
    },
    async enqueueProjectionJob(input) {
      return {
        id: "00000000-0000-4000-8000-000000000099",
        jobType: input.jobType,
        state: "queued",
        window: input.window,
        createdAt: new Date().toISOString()
      };
    },
    ...overrides
  };
}
