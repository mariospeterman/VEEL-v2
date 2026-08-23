import type postgres from "postgres";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { AnalyticsIdempotencyConflictError, AnalyticsRepositoryConfigurationError } from "./analytics-errors.js";
import { analyticsProjectionKey, getMetricDefinition } from "./metric-registry.js";
import type {
  AnalyticsDimensions,
  AnalyticsGranularity,
  AnalyticsProjectionHealth,
  AnalyticsRawPoint,
  AnalyticsRepository,
  AnalyticsScope,
  AnalyticsWindow
} from "./types.js";

interface MetricRow {
  bucket_date: string | null;
  value: string | number;
  numerator: string | number | null;
  denominator: string | number | null;
  sample_size: string | number;
}

export function createPostgresAnalyticsRepository(database?: string | PostgresSql): AnalyticsRepository {
  if (!database) {
    const fail = async (): Promise<never> => {
      throw new AnalyticsRepositoryConfigurationError();
    };
    return {
      authorizeScope: fail,
      queryMetric: fail,
      getWatermark: fail,
      recordSuppression: fail,
      getProjectionHealth: fail,
      enqueueProjectionJob: fail
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async authorizeScope(actorUserId, scope) {
      if (scope.type === "viewer") {
        const userId = scope.userId ?? actorUserId;
        return userId === actorUserId ? { type: "viewer", userId } : null;
      }
      if (scope.type === "creator") {
        const creatorUserId = scope.creatorUserId ?? actorUserId;
        return creatorUserId === actorUserId ? { type: "creator", creatorUserId } : null;
      }

      if (scope.type === "platform") {
        const rows = await sql<{ allowed: boolean }[]>`
          select exists (
            select 1 from staff_memberships
            where user_id = ${actorUserId}::uuid and state = 'active'
          ) as allowed
        `;
        return rows[0]?.allowed ? scope : null;
      }

      const rows = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1
          from organization_memberships membership
          join organizations organization on organization.id = membership.organization_id
          where membership.organization_id = ${scope.organizationId}::uuid
            and membership.user_id = ${actorUserId}::uuid
            and membership.state = 'active'
            and membership.role in ('owner', 'admin', 'member', 'viewer')
            and organization.state = 'active'
            and exists (
              select 1 from tier_waivers entitlement
              where entitlement.subject_type = 'organization'
                and entitlement.subject_id = organization.id
                and entitlement.tier_key = 'enterprise'
                and entitlement.state = 'active'
                and entitlement.starts_at <= now()
                and (entitlement.ends_at is null or entitlement.ends_at > now())
            )
        ) as allowed
      `;
      return rows[0]?.allowed ? scope : null;
    },

    async queryMetric(input) {
      const definition = getMetricDefinition(input.metricKey);
      if (!definition) return [];

      const rows = definition.source === "viewer_daily"
        ? await queryViewerDaily(sql, input.window, input.granularity, input.scope, definition)
        : definition.source === "creator_daily"
        ? await queryCreatorDaily(sql, input.window, input.granularity, input.scope, definition)
        : definition.source === "creator_content_daily"
          ? await queryCreatorContentDaily(sql, input.window, input.granularity, input.scope, input.dimensions, definition)
          : definition.source === "creator_product_daily"
            ? await queryCreatorProductDaily(sql, input.window, input.granularity, input.scope, input.dimensions, definition)
            : definition.source === "organization_creator_daily"
              ? await queryOrganizationCreatorDaily(sql, input.window, input.granularity, input.scope, input.dimensions, definition.valueColumn as string)
              : definition.source === "platform_commerce_daily"
                ? await queryPlatformCommerceDaily(sql, input.window, input.granularity, input.scope, input.dimensions, definition.valueColumn as string)
                : definition.source === "platform_operations_daily"
                  ? await queryPlatformOperationsDaily(sql, input.window, input.granularity, input.scope, definition.valueColumn as string)
                  : definition.source === "retention_daily"
                    ? await queryRetentionDaily(sql, input.window, input.granularity, input.scope, input.dimensions)
                    : await queryOnboardingDaily(sql, input.window, input.granularity, input.scope, input.dimensions, definition);

      return rows.map((row) => toRawPoint(row, definition.unit));
    },

    async getWatermark() {
      const rows = await sql<{ definition_version: number; data_through: Date; state: string }[]>`
        select definition_version, data_through, state
        from analytics_projection_watermarks
        where projection_key = ${analyticsProjectionKey}
      `;
      const row = rows[0];
      return row ? { definitionVersion: row.definition_version, dataThrough: row.data_through, state: row.state } : null;
    },

    async recordSuppression(input) {
      await sql`
        insert into analytics_privacy_suppression_daily (
          bucket_date, metric_key, scope_type, suppression_count, updated_at
        ) values (
          (now() at time zone 'UTC')::date,
          ${input.metricKey},
          ${input.scopeType},
          1,
          now()
        )
        on conflict (bucket_date, metric_key, scope_type) do update
        set suppression_count = analytics_privacy_suppression_daily.suppression_count + 1,
            updated_at = now()
      `;
    },

    async getProjectionHealth(now = new Date()) {
      const rows = await sql<{
        definition_version: number | null;
        watermark_state: string | null;
        data_through: Date | null;
        queued_count: string | number;
        leased_count: string | number;
        retry_count: string | number;
        dead_letter_count: string | number;
        reconciliation_state: "matched" | "mismatch" | "failed" | null;
        reconciliation_variance: string | number | null;
        suppression_count: string | number;
      }[]>`
        select
          watermark.definition_version,
          watermark.state as watermark_state,
          watermark.data_through,
          (select count(*) from analytics_projection_jobs where state = 'queued') as queued_count,
          (select count(*) from analytics_projection_jobs where state = 'leased') as leased_count,
          (select count(*) from analytics_projection_jobs where state = 'retry') as retry_count,
          (select count(*) from analytics_projection_jobs where state = 'dead_letter') as dead_letter_count,
          reconciliation.state as reconciliation_state,
          reconciliation.variance_count as reconciliation_variance,
          (select coalesce(sum(suppression_count), 0)
             from analytics_privacy_suppression_daily
            where bucket_date = (now() at time zone 'UTC')::date) as suppression_count
        from (select 1) seed
        left join analytics_projection_watermarks watermark
          on watermark.projection_key = ${analyticsProjectionKey}
        left join lateral (
          select state, variance_count
          from analytics_reconciliation_runs
          where projection_key = ${analyticsProjectionKey}
          order by completed_at desc, id desc
          limit 1
        ) reconciliation on true
      `;
      return toProjectionHealth(rows[0], now);
    },

    async enqueueProjectionJob(input) {
      return sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(
            hashtextextended(${`${analyticsProjectionKey}:${input.idempotencyKey}`}, 0)
          )
        `;
        const existingRows = await transaction<{
          id: string;
          reason: "backfill" | "reconciliation";
          state: "queued" | "leased" | "retry" | "completed" | "dead_letter";
          window_starts_on: string;
          window_ends_on: string;
          request_hash: string | null;
          created_at: Date;
        }[]>`
          select id, reason, state, window_starts_on::text, window_ends_on::text,
            request_hash, created_at
          from analytics_projection_jobs
          where projection_key = ${analyticsProjectionKey}
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const existing = existingRows[0];
        if (existing) {
          if (existing.request_hash !== input.requestHash) throw new AnalyticsIdempotencyConflictError();
          return toProjectionJobReceipt(existing);
        }

        const rows = await transaction<{
          id: string;
          reason: "backfill" | "reconciliation";
          state: "queued" | "leased" | "retry" | "completed" | "dead_letter";
          window_starts_on: string;
          window_ends_on: string;
          request_hash: string | null;
          created_at: Date;
        }[]>`
          insert into analytics_projection_jobs (
            projection_key, definition_version, window_starts_on, window_ends_on,
            reason, idempotency_key, request_hash, next_attempt_at
          ) values (
            ${analyticsProjectionKey}, 1, ${input.window.startDate}::date, ${input.window.endDate}::date,
            ${input.jobType}, ${input.idempotencyKey}, ${input.requestHash}, now()
          )
          returning id, reason, state, window_starts_on::text, window_ends_on::text,
            request_hash, created_at
        `;
        const job = rows[0];
        if (!job) throw new AnalyticsRepositoryConfigurationError();
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata
          ) values (
            gen_random_uuid(), ${input.actorUserId}::uuid, 'analytics_projection_job', ${job.id}::uuid,
            'analytics_projection_job_enqueued',
            ${transaction.json({
              jobType: input.jobType,
              window: input.window,
              reason: input.reason,
              definitionVersion: 1
            } as unknown as postgres.JSONValue)}
          )
        `;
        return toProjectionJobReceipt(job);
      });
    },

    async close() {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  };
}

function toProjectionJobReceipt(row: {
  id: string;
  reason: "backfill" | "reconciliation";
  state: "queued" | "leased" | "retry" | "completed" | "dead_letter";
  window_starts_on: string;
  window_ends_on: string;
  created_at: Date;
}) {
  return {
    id: row.id,
    jobType: row.reason,
    state: row.state,
    window: { startDate: row.window_starts_on, endDate: row.window_ends_on },
    createdAt: row.created_at.toISOString()
  };
}

async function queryCreatorDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  definition: NonNullable<ReturnType<typeof getMetricDefinition>>
): Promise<MetricRow[]> {
  if (scope.type !== "creator" || !scope.creatorUserId) return [];
  const numerator = definition.numeratorColumn ?? definition.valueColumn as string;
  const denominator = definition.denominatorColumn ?? null;
  const sampleColumn = denominator ?? numerator;
  if (granularity === "day") {
    return sql<MetricRow[]>`
      select bucket_date::text,
        case when ${denominator}::text is null then sum(${sql(numerator)})
             when sum(${sql(denominator ?? numerator)}) = 0 then 0
             else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
        ${denominator ? sql`sum(${sql(numerator)})` : sql`null::bigint`} as numerator,
        ${denominator ? sql`sum(${sql(denominator)})` : sql`null::bigint`} as denominator,
        sum(${sql(sampleColumn)}) as sample_size
      from analytics_creator_daily
      where creator_user_id = ${scope.creatorUserId}::uuid
        and bucket_date between ${window.startDate}::date and ${window.endDate}::date
      group by bucket_date order by bucket_date
    `;
  }
  return sql<MetricRow[]>`
    select null::text as bucket_date,
      case when ${denominator}::text is null then coalesce(sum(${sql(numerator)}), 0)
           when coalesce(sum(${sql(denominator ?? numerator)}), 0) = 0 then 0
           else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
      ${denominator ? sql`coalesce(sum(${sql(numerator)}), 0)` : sql`null::bigint`} as numerator,
      ${denominator ? sql`coalesce(sum(${sql(denominator)}), 0)` : sql`null::bigint`} as denominator,
      coalesce(sum(${sql(sampleColumn)}), 0) as sample_size
    from analytics_creator_daily
    where creator_user_id = ${scope.creatorUserId}::uuid
      and bucket_date between ${window.startDate}::date and ${window.endDate}::date
  `;
}

async function queryViewerDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  definition: NonNullable<ReturnType<typeof getMetricDefinition>>
): Promise<MetricRow[]> {
  if (scope.type !== "viewer" || !scope.userId) return [];
  const numerator = definition.numeratorColumn ?? definition.valueColumn as string;
  const denominator = definition.denominatorColumn ?? null;
  const bucket = granularity === "day" ? sql`bucket_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`bucket_date::text` : sql`null::text`} as bucket_date,
      case when ${denominator}::text is null then coalesce(sum(${sql(numerator)}), 0)
           when coalesce(sum(${sql(denominator ?? numerator)}), 0) = 0 then 0
           else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
      ${denominator ? sql`coalesce(sum(${sql(numerator)}), 0)` : sql`null::bigint`} as numerator,
      ${denominator ? sql`coalesce(sum(${sql(denominator)}), 0)` : sql`null::bigint`} as denominator,
      coalesce(sum(${sql(denominator ?? numerator)}), 0) as sample_size
    from analytics_viewer_daily
    where user_id = ${scope.userId}::uuid
      and bucket_date between ${window.startDate}::date and ${window.endDate}::date
    ${granularity === "day" ? sql`group by ${bucket} order by ${bucket}` : sql``}
  `;
}

async function queryCreatorContentDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions,
  definition: NonNullable<ReturnType<typeof getMetricDefinition>>
): Promise<MetricRow[]> {
  if (scope.type !== "creator" || !scope.creatorUserId) return [];
  const contentId = dimensions.contentId ?? null;
  const mediaType = dimensions.mediaType ?? null;
  const numerator = definition.numeratorColumn ?? definition.valueColumn as string;
  const denominator = definition.denominatorColumn ?? null;
  if (granularity === "day") {
    return sql<MetricRow[]>`
      select bucket_date::text,
        case when ${denominator}::text is null then sum(${sql(numerator)})
             when sum(${sql(denominator ?? numerator)}) = 0 then 0
             else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
        ${denominator ? sql`sum(${sql(numerator)})` : sql`null::bigint`} as numerator,
        ${denominator ? sql`sum(${sql(denominator)})` : sql`null::bigint`} as denominator,
        max(audience_sample_size) as sample_size
      from analytics_creator_content_daily
      where creator_user_id = ${scope.creatorUserId}::uuid
        and bucket_date between ${window.startDate}::date and ${window.endDate}::date
        and (${contentId}::uuid is null or content_item_id = ${contentId}::uuid)
        and (${mediaType}::text is null or media_type = ${mediaType})
      group by bucket_date order by bucket_date
    `;
  }
  return sql<MetricRow[]>`
    select null::text as bucket_date,
      case when ${denominator}::text is null then coalesce(sum(${sql(numerator)}), 0)
           when coalesce(sum(${sql(denominator ?? numerator)}), 0) = 0 then 0
           else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
      ${denominator ? sql`coalesce(sum(${sql(numerator)}), 0)` : sql`null::bigint`} as numerator,
      ${denominator ? sql`coalesce(sum(${sql(denominator)}), 0)` : sql`null::bigint`} as denominator,
      coalesce(max(audience_sample_size), 0) as sample_size
    from analytics_creator_content_daily
    where creator_user_id = ${scope.creatorUserId}::uuid
      and bucket_date between ${window.startDate}::date and ${window.endDate}::date
      and (${contentId}::uuid is null or content_item_id = ${contentId}::uuid)
      and (${mediaType}::text is null or media_type = ${mediaType})
  `;
}

async function queryCreatorProductDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions,
  definition: NonNullable<ReturnType<typeof getMetricDefinition>>
): Promise<MetricRow[]> {
  if (scope.type !== "creator" || !scope.creatorUserId || !dimensions.currency) return [];
  const productType = dimensions.productType ?? null;
  const numerator = definition.numeratorColumn ?? definition.valueColumn as string;
  const denominator = definition.denominatorColumn ?? null;
  const sampleColumn = denominator ?? (definition.unit === "minor_units" ? "confirmed_purchase_count" : numerator);
  const group = granularity === "day" ? sql`bucket_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`bucket_date::text` : sql`null::text`} as bucket_date,
      case when ${denominator}::text is null then coalesce(sum(${sql(numerator)}), 0)
           when coalesce(sum(${sql(denominator ?? numerator)}), 0) = 0 then 0
           else sum(${sql(numerator)})::numeric / sum(${sql(denominator ?? numerator)}) end as value,
      ${denominator ? sql`coalesce(sum(${sql(numerator)}), 0)` : sql`null::bigint`} as numerator,
      ${denominator ? sql`coalesce(sum(${sql(denominator)}), 0)` : sql`null::bigint`} as denominator,
      coalesce(sum(${sql(sampleColumn)}), 0) as sample_size
    from analytics_creator_product_daily
    where creator_user_id = ${scope.creatorUserId}::uuid
      and bucket_date between ${window.startDate}::date and ${window.endDate}::date
      and currency = ${dimensions.currency}
      and (${productType}::text is null or product_type = ${productType})
    ${granularity === "day" ? sql`group by ${group} order by ${group}` : sql``}
  `;
}

async function queryOrganizationCreatorDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions,
  column: string
): Promise<MetricRow[]> {
  if (scope.type !== "organization" || !dimensions.currency) return [];
  const creatorUserId = dimensions.creatorUserId ?? scope.creatorUserId ?? null;
  const group = granularity === "day" ? sql`projection.bucket_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`projection.bucket_date::text` : sql`null::text`} as bucket_date,
      coalesce(sum(projection.${sql(column)}), 0) as value,
      null::bigint as numerator, null::bigint as denominator,
      coalesce(sum(projection.confirmed_allocation_count), 0) as sample_size
    from analytics_organization_creator_daily projection
    join managed_creator_relationships relationship
      on relationship.organization_id = projection.organization_id
     and relationship.creator_user_id = projection.creator_user_id
     and relationship.state = 'active'
    join managed_creator_agreements agreement
      on agreement.relationship_id = relationship.id
     and agreement.state = 'accepted'
     and agreement.effective_at <= now()
     and (agreement.ends_at is null or agreement.ends_at > now())
     and agreement.permissions @> array['analytics_view']::text[]
    where projection.organization_id = ${scope.organizationId}::uuid
      and projection.bucket_date between ${window.startDate}::date and ${window.endDate}::date
      and projection.currency = ${dimensions.currency}
      and (${creatorUserId}::uuid is null or projection.creator_user_id = ${creatorUserId}::uuid)
    ${granularity === "day" ? sql`group by ${group} order by ${group}` : sql``}
  `;
}

async function queryPlatformCommerceDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions,
  column: string
): Promise<MetricRow[]> {
  if (scope.type !== "platform" || !dimensions.currency) return [];
  const bucket = granularity === "day" ? sql`bucket_date` : sql`null::date`;
  const sampleColumn = column === "confirmed_purchase_count" ? column : "confirmed_purchase_count";
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`bucket_date::text` : sql`null::text`} as bucket_date,
      coalesce(sum(${sql(column)}), 0) as value, null::bigint as numerator,
      null::bigint as denominator, coalesce(sum(${sql(sampleColumn)}), 0) as sample_size
    from analytics_platform_commerce_daily
    where currency = ${dimensions.currency}
      and bucket_date between ${window.startDate}::date and ${window.endDate}::date
    ${granularity === "day" ? sql`group by ${bucket} order by ${bucket}` : sql``}
  `;
}

async function queryPlatformOperationsDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  column: string
): Promise<MetricRow[]> {
  if (scope.type !== "platform") return [];
  const bucket = granularity === "day" ? sql`bucket_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`bucket_date::text` : sql`null::text`} as bucket_date,
      coalesce(sum(${sql(column)}), 0) as value, null::bigint as numerator,
      null::bigint as denominator, coalesce(sum(${sql(column)}), 0) as sample_size
    from analytics_platform_operations_daily
    where bucket_date between ${window.startDate}::date and ${window.endDate}::date
    ${granularity === "day" ? sql`group by ${bucket} order by ${bucket}` : sql``}
  `;
}

async function queryRetentionDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions
): Promise<MetricRow[]> {
  if (scope.type !== "platform" || !dimensions.cohortStartDate) return [];
  const bucket = granularity === "day" ? sql`activity_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`activity_date::text` : sql`null::text`} as bucket_date,
      coalesce(sum(active_user_count), 0) as value, null::bigint as numerator,
      null::bigint as denominator, coalesce(sum(active_user_count), 0) as sample_size
    from analytics_retention_daily
    where cohort_date = ${dimensions.cohortStartDate}::date
      and activity_date between ${window.startDate}::date and ${window.endDate}::date
    ${granularity === "day" ? sql`group by ${bucket} order by ${bucket}` : sql``}
  `;
}

async function queryOnboardingDaily(
  sql: postgres.Sql,
  window: AnalyticsWindow,
  granularity: AnalyticsGranularity,
  scope: AnalyticsScope,
  dimensions: AnalyticsDimensions,
  definition: NonNullable<ReturnType<typeof getMetricDefinition>>
): Promise<MetricRow[]> {
  if (scope.type !== "platform") return [];
  const requestedEvent = definition.numeratorEvent ?? dimensions.onboardingEvent ?? null;
  const denominatorEvent = definition.denominatorEvent ?? null;
  if (!requestedEvent) return [];
  const bucket = granularity === "day" ? sql`bucket_date` : sql`null::date`;
  return sql<MetricRow[]>`
    select ${granularity === "day" ? sql`bucket_date::text` : sql`null::text`} as bucket_date,
      case when ${denominatorEvent}::text is null
             then coalesce(sum(distinct_journey_count) filter (where event_key = ${requestedEvent}), 0)
           when coalesce(sum(distinct_journey_count) filter (where event_key = ${denominatorEvent}), 0) = 0 then 0
           else coalesce(sum(distinct_journey_count) filter (where event_key = ${requestedEvent}), 0)::numeric
             / sum(distinct_journey_count) filter (where event_key = ${denominatorEvent}) end as value,
      ${denominatorEvent
        ? sql`coalesce(sum(distinct_journey_count) filter (where event_key = ${requestedEvent}), 0)`
        : sql`null::bigint`} as numerator,
      ${denominatorEvent
        ? sql`coalesce(sum(distinct_journey_count) filter (where event_key = ${denominatorEvent}), 0)`
        : sql`null::bigint`} as denominator,
      coalesce(sum(distinct_journey_count) filter (where event_key = ${denominatorEvent ?? requestedEvent}), 0) as sample_size
    from analytics_onboarding_daily
    where bucket_date between ${window.startDate}::date and ${window.endDate}::date
      and event_key in (${requestedEvent}, ${denominatorEvent ?? requestedEvent})
    ${granularity === "day" ? sql`group by ${bucket} order by ${bucket}` : sql``}
  `;
}

function toRawPoint(row: MetricRow, unit: "count" | "seconds" | "ratio" | "minor_units"): AnalyticsRawPoint {
  return {
    bucketDate: row.bucket_date,
    value: unit === "ratio" ? Number(row.value) : String(row.value),
    numerator: row.numerator === null ? null : String(row.numerator),
    denominator: row.denominator === null ? null : String(row.denominator),
    sampleSize: String(row.sample_size)
  };
}

function toProjectionHealth(row: {
  definition_version: number | null;
  watermark_state: string | null;
  data_through: Date | null;
  queued_count: string | number;
  leased_count: string | number;
  retry_count: string | number;
  dead_letter_count: string | number;
  reconciliation_state: "matched" | "mismatch" | "failed" | null;
  reconciliation_variance: string | number | null;
  suppression_count: string | number;
} | undefined, now: Date): AnalyticsProjectionHealth {
  const dataThrough = row?.data_through ?? null;
  const lagSeconds = dataThrough ? Math.max(0, Math.floor((now.getTime() - dataThrough.getTime()) / 1000)) : null;
  const state = !dataThrough
    ? "unavailable"
    : row?.watermark_state === "failed" || row?.reconciliation_state === "failed"
      ? "failed"
      : row?.reconciliation_state === "mismatch"
        ? "reconciling"
        : lagSeconds !== null && lagSeconds > 120
          ? "stale"
          : "healthy";
  return {
    projectionKey: analyticsProjectionKey,
    definitionVersion: row?.definition_version ?? 1,
    state,
    dataThrough: dataThrough?.toISOString() ?? null,
    lagSeconds,
    queuedJobCount: Number(row?.queued_count ?? 0),
    leasedJobCount: Number(row?.leased_count ?? 0),
    retryJobCount: Number(row?.retry_count ?? 0),
    deadLetterJobCount: Number(row?.dead_letter_count ?? 0),
    latestReconciliationState: row?.reconciliation_state ?? null,
    latestReconciliationVariance: row?.reconciliation_variance === null || row?.reconciliation_variance === undefined ? null : Number(row.reconciliation_variance),
    suppressionCountToday: Number(row?.suppression_count ?? 0)
  };
}
