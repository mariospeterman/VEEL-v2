import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import { analyticsMetricRegistry } from "../src/modules/analytics/metric-registry.js";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-service.js";
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
    expect(analyticsMetricRegistry.size).toBeGreaterThanOrEqual(20);
    for (const definition of analyticsMetricRegistry.values()) {
      expect(definition.definitionVersion).toBe(1);
      expect(definition.minimumCohortSize).toBeGreaterThan(0);
      expect(definition.dimensions.every((dimension) => ["contentId", "mediaType", "currency", "productType", "creatorUserId"].includes(dimension))).toBe(true);
    }
  });

  it("suppresses a small audience without leaking numerator or denominator", async () => {
    const suppressions: string[] = [];
    const app = await analyticsApp(repositoryFixture({
      async queryMetric() {
        return [{ bucketDate: null, value: 3, numerator: 3, denominator: 4, sampleSize: 4 }];
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
      sampleSize: 4,
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
        return [{ bucketDate: null, value: call === 1 ? 12 : 8, numerator: null, denominator: null, sampleSize: 12 }];
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
      metrics: [{ comparisonValue: 8, deltaPercent: 50 }],
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
              { bucketDate: "2026-08-08", value: 0.5, numerator: 1, denominator: 2, sampleSize: 5 },
              { bucketDate: "2026-08-09", value: 1, numerator: 8, denominator: 8, sampleSize: 8 }
            ]
          : [{ bucketDate: null, value: 0.5, numerator: 5, denominator: 10, sampleSize: 10 }];
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
      async hasAdminAccess() { return admin; }
    } as unknown as AdminRepository
  });
}

function repositoryFixture(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  return {
    async authorizeScope(_actorUserId, scope): Promise<AnalyticsScope> {
      return scope.type === "creator"
        ? { type: "creator", creatorUserId: scope.creatorUserId ?? actorUserId }
        : scope;
    },
    async queryMetric() { return [{ bucketDate: null, value: 10, numerator: null, denominator: null, sampleSize: 10 }]; },
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
    ...overrides
  };
}
