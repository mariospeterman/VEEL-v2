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
      const points = applyPrivacy(rawPoints, definition.minimumCohortSize);
      let privacySuppressed = points.some((point) => point.privacyDecision !== "released");

      let comparisonValue: number | null = null;
      if (request.comparisonWindow) {
        const comparison = applyPrivacy(
          await this.repository.queryMetric({
            metricKey,
            scope,
            window: request.comparisonWindow,
            granularity: "total",
            dimensions
          }),
          definition.minimumCohortSize
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
  if (request.scope.type === "organization" && !isUuid(request.scope.organizationId)) {
    throw new AnalyticsQueryValidationError("organizationId must be a UUID");
  }

  const dimensions = request.dimensions ?? {};
  if (dimensions.contentId && !isUuid(dimensions.contentId)) throw new AnalyticsQueryValidationError("contentId must be a UUID");
  if (dimensions.creatorUserId && !isUuid(dimensions.creatorUserId)) throw new AnalyticsQueryValidationError("creatorUserId dimension must be a UUID");

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
    if ((definition.source === "creator_product_daily" || definition.source === "organization_creator_daily") && !dimensions.currency) {
      throw new AnalyticsQueryValidationError(`${metricKey} requires an explicit SOL or USDC currency dimension`);
    }
  }
}

function validateWindow(window: AnalyticsWindow, name: string): void {
  if (!window || !isoDatePattern.test(window.startDate) || !isoDatePattern.test(window.endDate)) {
    throw new AnalyticsQueryValidationError(`${name} requires ISO startDate and endDate values`);
  }
  const days = windowDays(window);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new AnalyticsQueryValidationError(`${name} must contain between one and 366 days`);
  }
}

function windowDays(window: AnalyticsWindow): number {
  const start = Date.parse(`${window.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${window.endDate}T00:00:00.000Z`);
  return (end - start) / 86_400_000 + 1;
}

function applyPrivacy(points: AnalyticsRawPoint[], minimumCohortSize: number): AnalyticsMetricPoint[] {
  return points.map((point) => {
    const suppressed = point.sampleSize < minimumCohortSize;
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
): number | null {
  const released = points.filter((point) => point.value !== null);
  if (released.length !== points.length || released.length === 0) return null;
  if (unit === "ratio" && released.every((point) => point.numerator !== null && point.denominator !== null)) {
    const numerator = released.reduce((total, point) => total + (point.numerator ?? 0), 0);
    const denominator = released.reduce((total, point) => total + (point.denominator ?? 0), 0);
    return denominator === 0 ? 0 : numerator / denominator;
  }
  return released.reduce((total, point) => total + (point.value ?? 0), 0);
}

function percentDelta(current: number | null, comparison: number | null): number | null {
  if (current === null || comparison === null || comparison === 0) return null;
  return Math.round(((current - comparison) / comparison) * 10_000) / 100;
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
  return scope.type === "creator" ? scope.creatorUserId ?? "self" : scope.organizationId;
}
