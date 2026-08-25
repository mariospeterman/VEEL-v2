import { AnalyticsQueryValidationError } from "./analytics-errors.js";
import { analyticsDefinitionVersion, getMetricDefinition } from "./metric-registry.js";
import type {
  AnalyticsInsight,
  AnalyticsMetricPoint,
  AnalyticsMetricResult,
  AnalyticsQueryRequest,
  AnalyticsQueryResponse,
  AnalyticsRawPoint,
  AnalyticsRepository,
  AnalyticsScope,
  AnalyticsWindow
} from "./types.js";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsQueryService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async query(actorUserId: string, request: AnalyticsQueryRequest, now = new Date()): Promise<AnalyticsQueryResponse | null> {
    validateRequest(request);
    const scope = await this.repository.authorizeScope(actorUserId, request.scope);
    if (!scope) return null;

    const dimensions = request.dimensions ?? {};
    const watermark = await this.repository.getWatermark();
    const metrics: AnalyticsMetricResult[] = [];

    for (const metricKey of request.metricKeys) {
      const definition = getMetricDefinition(metricKey) as NonNullable<ReturnType<typeof getMetricDefinition>>;
      const rawPoints = await this.repository.queryMetric({
        metricKey,
        scope,
        window: request.window,
        granularity: request.granularity,
        dimensions
      });
      const points = applyPrivacy(
        rawPoints,
        definition.privacyClass === "audience" ? definition.minimumCohortSize : 0
      );
      let privacySuppressed = points.some((point) => point.privacyDecision !== "released");

      let comparisonValue: AnalyticsMetricResult["comparisonValue"] = null;
      if (request.comparisonWindow) {
        const comparison = applyPrivacy(
          await this.repository.queryMetric({
            metricKey,
            scope,
            window: request.comparisonWindow,
            granularity: "total",
            dimensions
          }),
          definition.privacyClass === "audience" ? definition.minimumCohortSize : 0
        );
        privacySuppressed ||= comparison.some((point) => point.privacyDecision !== "released");
        comparisonValue = comparison[0]?.value ?? null;
      }
      if (privacySuppressed) {
        await this.repository.recordSuppression({ metricKey, scopeType: scope.type });
      }
      const currentValue = aggregateReleased(points, definition.unit);
      metrics.push({
        metricKey,
        definitionVersion: definition.definitionVersion,
        label: definition.label,
        unit: definition.unit,
        dimensions,
        points,
        comparisonValue,
        deltaPercent: percentDelta(currentValue, comparisonValue)
      });
    }

    const dataThrough = watermark?.dataThrough ?? null;
    const strictestFreshnessTarget = Math.min(
      ...request.metricKeys.map((key) => getMetricDefinition(key)?.freshnessTargetSeconds ?? 120)
    );
    const lagSeconds = dataThrough ? (now.getTime() - dataThrough.getTime()) / 1000 : null;
    const freshness = !dataThrough
      ? "unavailable"
      : watermark?.state !== "healthy" ||
          watermark.definitionVersion !== analyticsDefinitionVersion ||
          lagSeconds === null ||
          lagSeconds > strictestFreshnessTarget
        ? "stale"
        : "fresh";

    return {
      scope,
      window: request.window,
      comparisonWindow: request.comparisonWindow ?? null,
      granularity: request.granularity,
      timezone: request.timezone,
      dataThrough: dataThrough?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      freshness,
      metrics,
      insights: deterministicInsights(metrics, now)
    };
  }
}

export function validateRequest(request: AnalyticsQueryRequest): void {
  if (!request || typeof request !== "object") throw new AnalyticsQueryValidationError("A structured analytics query is required");
  if (!Array.isArray(request.metricKeys) || request.metricKeys.length < 1 || request.metricKeys.length > 20 || new Set(request.metricKeys).size !== request.metricKeys.length) {
    throw new AnalyticsQueryValidationError("Choose between one and twenty unique metrics");
  }
  validateWindow(request.window, "window");
  if (request.comparisonWindow) {
    validateWindow(request.comparisonWindow, "comparisonWindow");
    if (windowDays(request.window) !== windowDays(request.comparisonWindow)) {
      throw new AnalyticsQueryValidationError("Comparison windows must have the same number of days");
    }
  }
  if (request.timezone !== "UTC") throw new AnalyticsQueryValidationError("Analytics Core currently supports the explicit UTC timezone only");
  if (request.granularity !== "day" && request.granularity !== "total") throw new AnalyticsQueryValidationError("Unsupported analytics granularity");
  if (request.scope.type === "creator" && request.scope.creatorUserId && !isUuid(request.scope.creatorUserId)) {
    throw new AnalyticsQueryValidationError("creatorUserId must be a UUID");
  }
  if (request.scope.type === "viewer" && request.scope.userId && !isUuid(request.scope.userId)) {
    throw new AnalyticsQueryValidationError("userId must be a UUID");
  }
  if (request.scope.type === "organization" && !isUuid(request.scope.organizationId)) {
    throw new AnalyticsQueryValidationError("organizationId must be a UUID");
  }
  if (request.scope.type === "platform" && !/^[-a-z0-9_.:]{3,80}$/i.test(request.scope.purposeCode)) {
    throw new AnalyticsQueryValidationError("Platform analytics requires a bounded purposeCode");
  }

  const dimensions = request.dimensions ?? {};
  if (dimensions.contentId && !isUuid(dimensions.contentId)) throw new AnalyticsQueryValidationError("contentId must be a UUID");
  if (dimensions.creatorUserId && !isUuid(dimensions.creatorUserId)) throw new AnalyticsQueryValidationError("creatorUserId dimension must be a UUID");
  if (dimensions.cohortStartDate && !isIsoDate(dimensions.cohortStartDate)) throw new AnalyticsQueryValidationError("cohortStartDate must be an ISO date");
  if (dimensions.onboardingEvent && !onboardingEvents.has(dimensions.onboardingEvent)) throw new AnalyticsQueryValidationError("Unsupported onboardingEvent");

  for (const metricKey of request.metricKeys) {
    const definition = getMetricDefinition(metricKey);
    if (!definition) throw new AnalyticsQueryValidationError(`Unsupported metric: ${metricKey}`);
    if (!definition.supportedScopes.includes(request.scope.type)) {
      throw new AnalyticsQueryValidationError(`${metricKey} does not support the requested scope`);
    }
    for (const dimension of Object.keys(dimensions)) {
      if (!definition.dimensions.includes(dimension as keyof typeof dimensions)) {
        throw new AnalyticsQueryValidationError(`${dimension} is not allowed for ${metricKey}`);
      }
    }
    if ((definition.source === "creator_product_daily" || definition.source === "organization_creator_daily" || definition.source === "platform_commerce_daily") && !dimensions.currency) {
      throw new AnalyticsQueryValidationError(`${metricKey} requires an explicit SOL or USDC currency dimension`);
    }
    if (definition.source === "retention_daily" && !dimensions.cohortStartDate) {
      throw new AnalyticsQueryValidationError(`${metricKey} requires cohortStartDate`);
    }
    if (metricKey === "platform.onboarding.step_events" && !dimensions.onboardingEvent) {
      throw new AnalyticsQueryValidationError(`${metricKey} requires onboardingEvent`);
    }
  }
}

function validateWindow(window: AnalyticsWindow, name: string): void {
  if (!window || !isIsoDate(window.startDate) || !isIsoDate(window.endDate)) {
    throw new AnalyticsQueryValidationError(`${name} requires ISO startDate and endDate values`);
  }
  const days = windowDays(window);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new AnalyticsQueryValidationError(`${name} must contain between one and 366 days`);
  }
}

function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateProjectionWindow(window: AnalyticsWindow): void {
  validateWindow(window, "window");
}

function windowDays(window: AnalyticsWindow): number {
  const start = Date.parse(`${window.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${window.endDate}T00:00:00.000Z`);
  return (end - start) / 86_400_000 + 1;
}

function applyPrivacy(points: AnalyticsRawPoint[], minimumCohortSize: number): AnalyticsMetricPoint[] {
  return points.map((point) => {
    const suppressed = BigInt(point.sampleSize) < BigInt(minimumCohortSize);
    return {
      bucketDate: point.bucketDate,
      value: suppressed ? null : point.value,
      numerator: suppressed ? null : point.numerator,
      denominator: suppressed ? null : point.denominator,
      sampleSize: point.sampleSize,
      privacyDecision: suppressed ? "suppressed_minimum_cohort" : "released"
    };
  });
}

function aggregateReleased(
  points: AnalyticsMetricPoint[],
  unit: AnalyticsMetricResult["unit"]
): AnalyticsMetricResult["comparisonValue"] {
  const released = points.filter((point) => point.value !== null);
  if (released.length !== points.length || released.length === 0) return null;
  if (unit === "ratio" && released.every((point) => point.numerator !== null && point.denominator !== null)) {
    const numerator = released.reduce((total, point) => total + BigInt(point.numerator ?? "0"), 0n);
    const denominator = released.reduce((total, point) => total + BigInt(point.denominator ?? "0"), 0n);
    return denominator === 0n ? 0 : Number(numerator) / Number(denominator);
  }
  return released.reduce((total, point) => total + BigInt(String(point.value ?? "0")), 0n).toString();
}

function percentDelta(
  current: AnalyticsMetricResult["comparisonValue"],
  comparison: AnalyticsMetricResult["comparisonValue"]
): number | null {
  if (current === null || comparison === null) return null;
  const currentNumber = Number(current);
  const comparisonNumber = Number(comparison);
  if (comparisonNumber === 0) return null;
  return Math.round(((currentNumber - comparisonNumber) / comparisonNumber) * 10_000) / 100;
}

function deterministicInsights(metrics: AnalyticsMetricResult[], now: Date): AnalyticsInsight[] {
  return metrics.flatMap((metric) => {
    if (metric.deltaPercent === null || Math.abs(metric.deltaPercent) < 10) return [];
    const increasing = metric.deltaPercent > 0;
    const magnitude = Math.abs(metric.deltaPercent).toFixed(1);
    return [{
      metricKey: metric.metricKey,
      observation: `${metric.label} was ${magnitude}% ${increasing ? "higher" : "lower"} than the comparison window.`,
      evidence: `Definition v${metric.definitionVersion}; identical scope, dimensions, and window length.`,
      confidence: Math.abs(metric.deltaPercent) >= 25 ? "high" : "moderate",
      uncertainty: "This deterministic comparison is correlational and does not establish cause.",
      experiment: `Test one bounded content or distribution change and hold other inputs stable for the next equal window.`,
      expectedDirection: increasing ? "increase" : "decrease",
      successMetric: metric.metricKey,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString()
    } satisfies AnalyticsInsight];
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function scopeKey(scope: AnalyticsScope): string {
  if (scope.type === "viewer") return scope.userId ?? "self";
  if (scope.type === "creator") return scope.creatorUserId ?? "self";
  if (scope.type === "organization") return scope.organizationId;
  return `platform:${scope.purposeCode}`;
}

const onboardingEvents = new Set([
  "landing_viewed", "landing_cta_clicked", "landing_nav_clicked", "landing_section_viewed",
  "landing_money_example_viewed", "landing_comparison_viewed", "landing_faq_opened",
  "login_opened", "onboarding_opened", "auth_method_selected",
  "wallet_runtime_ready", "wallet_authentication_completed", "wallet_ownership_verified",
  "profile_step_viewed", "profile_step_completed", "age_step_started", "age_step_completed",
  "age_step_failed", "protected_app_entered", "onboarding_abandoned",
  "returning_login_completed", "account_not_found"
]);
