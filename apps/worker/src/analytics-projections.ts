import { randomUUID } from "node:crypto";
import postgres from "postgres";

export interface AnalyticsProjectionJob {
  id: string;
  projectionKey: string;
  definitionVersion: number;
  windowStartsOn: string;
  windowEndsOn: string;
  reason: "incremental" | "late_fact" | "backfill" | "reconciliation";
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
}

export interface AnalyticsProjectionEvidence {
  sourceRowCount: number;
  projectedRowCount: number;
  varianceCount: number;
  projectedTableRowCount: number;
  dataThrough: Date;
  details: Record<string, number>;
}

export interface AnalyticsProjectionOutcome {
  state: "completed" | "retry" | "dead_letter";
  evidence?: AnalyticsProjectionEvidence;
  errorCode?: string;
}

export interface AnalyticsProjectionRepository {
  enqueueIncremental(now: Date): Promise<void>;
  leaseJobs(input: { now: Date; limit: number }): Promise<AnalyticsProjectionJob[]>;
  projectWindow(job: AnalyticsProjectionJob): Promise<AnalyticsProjectionEvidence>;
  recordOutcome(input: { job: AnalyticsProjectionJob; outcome: AnalyticsProjectionOutcome; now: Date }): Promise<void>;
  close?(): Promise<void>;
}

export interface ProcessAnalyticsProjectionsResult {
  leased: number;
  completed: number;
  retrying: number;
  deadLettered: number;
  mismatched: number;
}

export async function processAnalyticsProjections(input: {
  repository: AnalyticsProjectionRepository;
  now?: Date;
  limit?: number;
}): Promise<ProcessAnalyticsProjectionsResult> {
  const now = input.now ?? new Date();
  await input.repository.enqueueIncremental(now);
  const jobs = await input.repository.leaseJobs({ now, limit: input.limit ?? 10 });
  const result: ProcessAnalyticsProjectionsResult = {
    leased: jobs.length,
    completed: 0,
    retrying: 0,
    deadLettered: 0,
    mismatched: 0
  };

  for (const job of jobs) {
    try {
      const evidence = await input.repository.projectWindow(job);
      await input.repository.recordOutcome({ job, outcome: { state: "completed", evidence }, now });
      result.completed += 1;
      if (evidence.varianceCount !== 0) result.mismatched += 1;
    } catch {
      const exhausted = job.attemptCount >= job.maxAttempts;
      await input.repository.recordOutcome({
        job,
        outcome: {
          state: exhausted ? "dead_letter" : "retry",
          errorCode: "analytics_projection_failed"
        },
        now
      });
      if (exhausted) result.deadLettered += 1;
      else result.retrying += 1;
    }
  }

  return result;
}

export function createPostgresAnalyticsProjectionRepository(databaseUrl: string): AnalyticsProjectionRepository {
  const sql = postgres(databaseUrl, { max: 4, idle_timeout: 20, prepare: false });

  return {
    async enqueueIncremental(now) {
      const hourSlot = now.toISOString().slice(0, 13);
      await sql`
        insert into analytics_projection_jobs (
          projection_key, definition_version, window_starts_on, window_ends_on,
          reason, idempotency_key, next_attempt_at
        ) values (
          'analytics_core', 1,
          ((${now.toISOString()}::timestamptz at time zone 'UTC')::date - 1),
          ((${now.toISOString()}::timestamptz at time zone 'UTC')::date),
          'incremental',
          ${`incremental:${hourSlot}`},
          ${now.toISOString()}::timestamptz
        )
        on conflict (projection_key, idempotency_key) do nothing
      `;
    },

    async leaseJobs(input) {
      const leaseToken = randomUUID();
      const rows = await sql<{
        id: string;
        projection_key: string;
        definition_version: number;
        window_starts_on: string;
        window_ends_on: string;
        reason: AnalyticsProjectionJob["reason"];
        attempt_count: number;
        max_attempts: number;
        lease_token: string;
      }[]>`
        with due as (
          select id
          from analytics_projection_jobs
          where (
              state in ('queued', 'retry') and next_attempt_at <= ${input.now.toISOString()}::timestamptz
            ) or (
              state = 'leased' and leased_until < ${input.now.toISOString()}::timestamptz
            )
          order by window_starts_on, created_at, id
          for update skip locked
          limit ${input.limit}
        )
        update analytics_projection_jobs job
        set state = 'leased',
            attempt_count = job.attempt_count + 1,
            lease_token = ${leaseToken}::uuid,
            leased_until = ${input.now.toISOString()}::timestamptz + interval '5 minutes',
            updated_at = ${input.now.toISOString()}::timestamptz
        from due
        where job.id = due.id
        returning job.id, job.projection_key, job.definition_version,
          job.window_starts_on::text, job.window_ends_on::text, job.reason,
          job.attempt_count, job.max_attempts, job.lease_token::text
      `;
      return rows.map((row) => ({
        id: row.id,
        projectionKey: row.projection_key,
        definitionVersion: row.definition_version,
        windowStartsOn: row.window_starts_on,
        windowEndsOn: row.window_ends_on,
        reason: row.reason,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        leaseToken: row.lease_token
      }));
    },

    async projectWindow(job) {
      if (job.projectionKey !== "analytics_core" || job.definitionVersion !== 1) {
        throw new Error("ANALYTICS_PROJECTION_DEFINITION_MISMATCH");
      }
      return sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${job.projectionKey}, 0))
        `;
        await transaction`
          delete from analytics_creator_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_creator_daily (
            bucket_date, creator_user_id, published_content_count, follower_start_count,
            creator_hide_count, creator_report_count, updated_at
          )
          with facts as (
            select coalesce(content.published_at, content.created_at)::date as bucket_date,
              content.creator_user_id, count(*) as published_count, 0::bigint as follower_count,
              0::bigint as hide_count, 0::bigint as report_count
            from content_items content
            where content.publish_state = 'published'
              and coalesce(content.published_at, content.created_at)::date
                between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select follow.created_at::date, follow.followed_user_id, 0, count(*), 0, 0
            from user_follows follow
            where follow.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select hidden.created_at::date, hidden.creator_user_id, 0, 0, count(*), 0
            from viewer_hidden_creators hidden
            where hidden.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select report.created_at::date, report.subject_id, 0, 0, 0, count(*)
            from reports report
            where report.subject_type = 'user'
              and report.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and exists (select 1 from users where id = report.subject_id)
            group by 1, 2
          )
          select bucket_date, creator_user_id, sum(published_count), sum(follower_count),
            sum(hide_count), sum(report_count), now()
          from facts
          group by bucket_date, creator_user_id
        `;

        await transaction`
          delete from analytics_creator_content_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_creator_content_daily (
            bucket_date, creator_user_id, content_item_id, media_type,
            impression_count, qualified_view_count, credited_watch_seconds,
            completed_view_count, early_skip_count, replay_count,
            like_count, comment_count, save_count, share_count,
            audience_sample_size, updated_at
          )
          with session_stats as (
            select session.created_at::date as bucket_date,
              content.creator_user_id, content.id as content_item_id, content.media_type,
              session.user_id, session.id as session_id,
              coalesce(sum(heartbeat.credited_seconds), 0)::bigint as credited_seconds,
              max(asset.duration_ms)::bigint as duration_ms
            from platform_playback_sessions session
            join content_items content on session.target_type = 'content' and content.id = session.target_id
            left join platform_playback_heartbeats heartbeat on heartbeat.session_id = session.id
            left join media_assets asset on asset.content_item_id = content.id and asset.duration_ms is not null
            where session.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4, 5, 6
          ),
          viewer_playback as (
            select bucket_date, creator_user_id, content_item_id, media_type, user_id,
              count(*) filter (where credited_seconds >= 2) as qualified_views,
              sum(credited_seconds) as watch_seconds,
              count(*) filter (
                where credited_seconds >= 2 and duration_ms is not null
                  and credited_seconds * 1000 >= duration_ms * 0.9
              ) as completed_views,
              count(*) filter (where credited_seconds < 2) as early_skips,
              greatest(count(*) filter (where credited_seconds >= 2) - 1, 0) as replays
            from session_stats
            group by 1, 2, 3, 4, 5
          ),
          playback as (
            select bucket_date, creator_user_id, content_item_id, media_type,
              sum(qualified_views) as qualified_views, sum(watch_seconds) as watch_seconds,
              sum(completed_views) as completed_views, sum(early_skips) as early_skips,
              sum(replays) as replays
            from viewer_playback group by 1, 2, 3, 4
          ),
          impressions as (
            select receipt.created_at::date as bucket_date, content.creator_user_id,
              content.id as content_item_id, content.media_type, count(*) as impression_count
            from feed_impression_receipts receipt
            join content_items content on content.id = receipt.content_item_id
            where receipt.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          likes as (
            select reaction.created_at::date as bucket_date, content.creator_user_id,
              content.id as content_item_id, content.media_type, count(*) as like_count
            from content_reactions reaction join content_items content on content.id = reaction.content_item_id
            where reaction.state = 'active' and reaction.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          comments_daily as (
            select comment.created_at::date as bucket_date, content.creator_user_id,
              content.id as content_item_id, content.media_type, count(*) as comment_count
            from comments comment join content_items content on content.id = comment.content_item_id
            where comment.moderation_state = 'visible' and comment.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          saves as (
            select save.created_at::date as bucket_date, content.creator_user_id,
              content.id as content_item_id, content.media_type, count(*) as save_count
            from content_saves save join content_items content on content.id = save.content_item_id
            where save.state = 'active' and save.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          shares as (
            select share.created_at::date as bucket_date, content.creator_user_id,
              content.id as content_item_id, content.media_type, count(*) as share_count
            from share_records share join content_items content on content.id = share.target_id
            where share.target_type = 'content' and share.state = 'created'
              and share.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          audience as (
            select bucket_date, creator_user_id, content_item_id, count(distinct user_id) as sample_size
            from (
              select receipt.created_at::date as bucket_date, content.creator_user_id,
                receipt.content_item_id, receipt.user_id
              from feed_impression_receipts receipt join content_items content on content.id = receipt.content_item_id
              where receipt.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              union
              select bucket_date, creator_user_id, content_item_id, user_id from viewer_playback
              union
              select reaction.created_at::date, content.creator_user_id, reaction.content_item_id, reaction.user_id
              from content_reactions reaction join content_items content on content.id = reaction.content_item_id
              where reaction.state = 'active' and reaction.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              union
              select comment.created_at::date, content.creator_user_id, comment.content_item_id, comment.user_id
              from comments comment join content_items content on content.id = comment.content_item_id
              where comment.moderation_state = 'visible' and comment.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              union
              select save.created_at::date, content.creator_user_id, save.content_item_id, save.user_id
              from content_saves save join content_items content on content.id = save.content_item_id
              where save.state = 'active' and save.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            ) audience_users
            group by 1, 2, 3
          ),
          keys as (
            select bucket_date, creator_user_id, content_item_id, media_type from impressions
            union select bucket_date, creator_user_id, content_item_id, media_type from playback
            union select bucket_date, creator_user_id, content_item_id, media_type from likes
            union select bucket_date, creator_user_id, content_item_id, media_type from comments_daily
            union select bucket_date, creator_user_id, content_item_id, media_type from saves
            union select bucket_date, creator_user_id, content_item_id, media_type from shares
          )
          select key.bucket_date, key.creator_user_id, key.content_item_id, key.media_type,
            coalesce(impression.impression_count, 0), coalesce(playback.qualified_views, 0),
            coalesce(playback.watch_seconds, 0), coalesce(playback.completed_views, 0),
            coalesce(playback.early_skips, 0), coalesce(playback.replays, 0),
            coalesce(like_fact.like_count, 0), coalesce(comment_fact.comment_count, 0),
            coalesce(save_fact.save_count, 0), coalesce(share_fact.share_count, 0),
            coalesce(audience.sample_size, 0), now()
          from keys key
          left join impressions impression using (bucket_date, creator_user_id, content_item_id, media_type)
          left join playback using (bucket_date, creator_user_id, content_item_id, media_type)
          left join likes like_fact using (bucket_date, creator_user_id, content_item_id, media_type)
          left join comments_daily comment_fact using (bucket_date, creator_user_id, content_item_id, media_type)
          left join saves save_fact using (bucket_date, creator_user_id, content_item_id, media_type)
          left join shares share_fact using (bucket_date, creator_user_id, content_item_id, media_type)
          left join audience using (bucket_date, creator_user_id, content_item_id)
        `;

        await transaction`
          delete from analytics_creator_product_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_creator_product_daily (
            bucket_date, creator_user_id, product_type, currency,
            confirmed_purchase_count, confirmed_gross_minor,
            creator_earnings_minor, platform_fee_minor, updated_at
          )
          select intent.confirmed_at::date, earning.account_user_id,
            case when intent.product_type = 'tip' then 'support' else intent.product_type end,
            intent.currency, count(*), sum(intent.amount_minor), sum(earning.amount_minor),
            sum(coalesce(fee.amount_minor, 0)), now()
          from payment_intents intent
          join payment_ledger_entries earning
            on earning.payment_intent_id = intent.id
           and earning.account_kind = 'creator_earning'
           and earning.state = 'posted'
           and earning.account_user_id is not null
          left join payment_ledger_entries fee
            on fee.payment_intent_id = intent.id
           and fee.account_kind = 'platform_fee'
           and fee.state = 'posted'
          where intent.state = 'confirmed'
            and intent.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            and intent.currency in ('SOL', 'USDC')
          group by 1, 2, 3, 4
        `;

        await transaction`
          delete from analytics_organization_creator_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_organization_creator_daily (
            bucket_date, organization_id, creator_user_id, currency,
            confirmed_allocation_count, creator_side_proceeds_minor,
            creator_net_minor, enterprise_management_minor, updated_at
          )
          select allocation.confirmed_at::date, allocation.organization_id,
            allocation.creator_user_id, allocation.currency, count(*),
            sum(allocation.creator_side_proceeds_minor), sum(allocation.creator_net_minor),
            sum(allocation.enterprise_management_minor), now()
          from managed_creator_allocation_records allocation
          where allocation.state = 'confirmed'
            and allocation.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
          group by 1, 2, 3, 4
        `;

        const parityRows = await transaction<{
          source_impressions: string | number;
          projected_impressions: string | number;
          source_purchases: string | number;
          projected_purchases: string | number;
          source_allocations: string | number;
          projected_allocations: string | number;
          projected_table_rows: string | number;
          data_through: Date;
        }[]>`
          select
            (select count(*) from feed_impression_receipts where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_impressions,
            (select coalesce(sum(impression_count), 0) from analytics_creator_content_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_impressions,
            (select count(*) from payment_intents intent where intent.state = 'confirmed'
              and intent.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and exists (select 1 from payment_ledger_entries entry where entry.payment_intent_id = intent.id and entry.account_kind = 'creator_earning' and entry.state = 'posted')) as source_purchases,
            (select coalesce(sum(confirmed_purchase_count), 0) from analytics_creator_product_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_purchases,
            (select count(*) from managed_creator_allocation_records where state = 'confirmed' and confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_allocations,
            (select coalesce(sum(confirmed_allocation_count), 0) from analytics_organization_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_allocations,
            ((select count(*) from analytics_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_creator_content_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_creator_product_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_organization_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)) as projected_table_rows,
            least(
              now(),
              ${job.windowEndsOn}::date + interval '1 day' - interval '1 millisecond'
            ) as data_through
        `;
        const parity = parityRows[0];
        const details = {
          sourceImpressions: Number(parity?.source_impressions ?? 0),
          projectedImpressions: Number(parity?.projected_impressions ?? 0),
          sourcePurchases: Number(parity?.source_purchases ?? 0),
          projectedPurchases: Number(parity?.projected_purchases ?? 0),
          sourceAllocations: Number(parity?.source_allocations ?? 0),
          projectedAllocations: Number(parity?.projected_allocations ?? 0)
        };
        const sourceRowCount = details.sourceImpressions + details.sourcePurchases + details.sourceAllocations;
        const projectedRowCount = details.projectedImpressions + details.projectedPurchases + details.projectedAllocations;
        return {
          sourceRowCount,
          projectedRowCount,
          varianceCount: projectedRowCount - sourceRowCount,
          projectedTableRowCount: Number(parity?.projected_table_rows ?? 0),
          dataThrough: parity?.data_through ?? new Date(0),
          details
        };
      }) as Promise<AnalyticsProjectionEvidence>;
    },

    async recordOutcome(input) {
      if (input.outcome.state === "completed" && input.outcome.evidence) {
        const evidence = input.outcome.evidence;
        await sql.begin(async (transaction) => {
          const updated = await transaction<{ id: string }[]>`
            update analytics_projection_jobs
            set state = 'completed', leased_until = null, lease_token = null,
                last_error_code = null, completed_at = ${input.now.toISOString()}::timestamptz,
                updated_at = ${input.now.toISOString()}::timestamptz
            where id = ${input.job.id}::uuid and state = 'leased'
              and lease_token = ${input.job.leaseToken}::uuid
            returning id
          `;
          if (!updated[0]) return;
          await transaction`
            insert into analytics_reconciliation_runs (
              projection_key, definition_version, job_id, window_starts_on, window_ends_on,
              state, source_row_count, projected_row_count, variance_count, details,
              started_at, completed_at
            ) values (
              ${input.job.projectionKey}, ${input.job.definitionVersion}, ${input.job.id}::uuid,
              ${input.job.windowStartsOn}::date, ${input.job.windowEndsOn}::date,
              ${evidence.varianceCount === 0 ? "matched" : "mismatch"},
              ${evidence.sourceRowCount}, ${evidence.projectedRowCount}, ${evidence.varianceCount},
              ${sql.json(evidence.details)}, ${input.now.toISOString()}::timestamptz,
              ${input.now.toISOString()}::timestamptz
            )
          `;
          await transaction`
            insert into analytics_projection_watermarks (
              projection_key, definition_version, data_through, last_job_id,
              state, projected_row_count, updated_at
            ) values (
              ${input.job.projectionKey}, ${input.job.definitionVersion}, ${evidence.dataThrough.toISOString()}::timestamptz,
              ${input.job.id}::uuid, ${evidence.varianceCount === 0 ? "healthy" : "reconciling"},
              ${evidence.projectedTableRowCount}, ${input.now.toISOString()}::timestamptz
            )
            on conflict (projection_key) do update
            set definition_version = excluded.definition_version,
                data_through = greatest(analytics_projection_watermarks.data_through, excluded.data_through),
                last_job_id = excluded.last_job_id,
                state = excluded.state,
                projected_row_count = excluded.projected_row_count,
                updated_at = excluded.updated_at
          `;
        });
        return;
      }

      const state = input.outcome.state;
      const retryDelaySeconds = Math.min(900, 15 * 2 ** Math.max(0, input.job.attemptCount - 1));
      await sql`
        update analytics_projection_jobs
        set state = ${state}, leased_until = null, lease_token = null,
            last_error_code = ${input.outcome.errorCode ?? "analytics_projection_failed"},
            next_attempt_at = ${input.now.toISOString()}::timestamptz + make_interval(secs => ${retryDelaySeconds}),
            updated_at = ${input.now.toISOString()}::timestamptz
        where id = ${input.job.id}::uuid and state = 'leased'
          and lease_token = ${input.job.leaseToken}::uuid
      `;
    },

    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
