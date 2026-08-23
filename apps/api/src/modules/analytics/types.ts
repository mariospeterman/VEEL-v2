export type AnalyticsScope =
  | { type: "viewer"; userId?: string }
  | { type: "creator"; creatorUserId?: string }
  | { type: "organization"; organizationId: string; creatorUserId?: string }
  | { type: "platform"; purposeCode: string };

export type AnalyticsGranularity = "day" | "total";

export interface AnalyticsDimensions {
  creatorUserId?: string;
  contentId?: string;
  mediaType?: string;
  currency?: "SOL" | "USDC";
  productType?: string;
  onboardingEvent?: string;
  cohortStartDate?: string;
}

export type AnalyticsScalar = string | number;

export interface AnalyticsWindow {
  startDate: string;
  endDate: string;
}

export interface AnalyticsQueryRequest {
  scope: AnalyticsScope;
  metricKeys: string[];
  window: AnalyticsWindow;
  comparisonWindow?: AnalyticsWindow;
  granularity: AnalyticsGranularity;
  timezone: "UTC";
  dimensions?: AnalyticsDimensions;
}

export interface AnalyticsRawPoint {
  bucketDate: string | null;
  value: AnalyticsScalar;
  numerator: string | null;
  denominator: string | null;
  sampleSize: string;
}

export interface AnalyticsMetricPoint {
  bucketDate: string | null;
  value: AnalyticsScalar | null;
  numerator: string | null;
  denominator: string | null;
  sampleSize: string;
  privacyDecision: "released" | "suppressed_minimum_cohort";
}

export interface AnalyticsMetricResult {
  metricKey: string;
  definitionVersion: number;
  label: string;
  unit: "count" | "seconds" | "ratio" | "minor_units";
  dimensions: AnalyticsDimensions;
  points: AnalyticsMetricPoint[];
  comparisonValue: AnalyticsScalar | null;
  deltaPercent: number | null;
}

export interface AnalyticsInsight {
  metricKey: string;
  observation: string;
  evidence: string;
  confidence: "moderate" | "high";
  uncertainty: string;
  experiment: string;
  expectedDirection: "increase" | "decrease";
  successMetric: string;
  expiresAt: string;
}

export interface AnalyticsQueryResponse {
  scope: AnalyticsScope;
  window: AnalyticsWindow;
  comparisonWindow: AnalyticsWindow | null;
  granularity: AnalyticsGranularity;
  timezone: "UTC";
  dataThrough: string | null;
  generatedAt: string;
  freshness: "fresh" | "stale" | "unavailable";
  metrics: AnalyticsMetricResult[];
  insights: AnalyticsInsight[];
}

export interface AnalyticsProjectionHealth {
  projectionKey: string;
  definitionVersion: number;
  state: "healthy" | "stale" | "reconciling" | "failed" | "unavailable";
  dataThrough: string | null;
  lagSeconds: number | null;
  queuedJobCount: number;
  leasedJobCount: number;
  retryJobCount: number;
  deadLetterJobCount: number;
  latestReconciliationState: "matched" | "mismatch" | "failed" | null;
  latestReconciliationVariance: number | null;
  suppressionCountToday: number;
}

export interface AnalyticsProjectionJobReceipt {
  id: string;
  jobType: "backfill" | "reconciliation";
  state: "queued" | "leased" | "retry" | "completed" | "dead_letter";
  window: AnalyticsWindow;
  createdAt: string;
}

export interface AnalyticsRepository {
  authorizeScope(actorUserId: string, scope: AnalyticsScope): Promise<AnalyticsScope | null>;
  queryMetric(input: {
    metricKey: string;
    scope: AnalyticsScope;
    window: AnalyticsWindow;
    granularity: AnalyticsGranularity;
    dimensions: AnalyticsDimensions;
  }): Promise<AnalyticsRawPoint[]>;
  getWatermark(): Promise<{ definitionVersion: number; dataThrough: Date; state: string } | null>;
  recordSuppression(input: { metricKey: string; scopeType: AnalyticsScope["type"] }): Promise<void>;
  getProjectionHealth(now?: Date): Promise<AnalyticsProjectionHealth>;
  enqueueProjectionJob(input: {
    actorUserId: string;
    jobType: "backfill" | "reconciliation";
    window: AnalyticsWindow;
    reason: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<AnalyticsProjectionJobReceipt>;
  close?(): Promise<void>;
}
