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
            creator_hide_count, creator_report_count, feed_impression_count,
            profile_open_count, follow_after_view_count, updated_at
          )
          with facts as (
            select coalesce(content.published_at, content.created_at)::date as bucket_date,
              content.creator_user_id, count(*) as published_count, 0::bigint as follower_count,
              0::bigint as hide_count, 0::bigint as report_count, 0::bigint as impression_count,
              0::bigint as profile_open_count, 0::bigint as follow_after_view_count
            from content_items content
            where content.publish_state = 'published'
              and coalesce(content.published_at, content.created_at)::date
                between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select follow.created_at::date, follow.followed_user_id, 0, count(*), 0, 0, 0, 0, 0
            from user_follows follow
            where follow.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select hidden.created_at::date, hidden.creator_user_id, 0, 0, count(*), 0, 0, 0, 0
            from viewer_hidden_creators hidden
            where hidden.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select report.created_at::date, report.subject_id, 0, 0, 0, count(*), 0, 0, 0
            from reports report
            where report.subject_type = 'user'
              and report.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and exists (select 1 from users where id = report.subject_id)
            group by 1, 2
            union all
            select receipt.created_at::date, content.creator_user_id, 0, 0, 0, 0, count(*), 0, 0
            from feed_impression_receipts receipt
            join content_items content on content.id = receipt.content_item_id
            where receipt.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select receipt.created_at::date, receipt.profile_user_id, 0, 0, 0, 0, 0, count(*), 0
            from analytics_profile_open_receipts receipt
            where receipt.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select follow.created_at::date, follow.followed_user_id, 0, 0, 0, 0, 0, 0, count(*)
            from user_follows follow
            where follow.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and exists (
                select 1
                from feed_impression_receipts receipt
                join content_items content on content.id = receipt.content_item_id
                where receipt.user_id = follow.follower_user_id
                  and content.creator_user_id = follow.followed_user_id
                  and receipt.created_at::date = follow.created_at::date
                  and receipt.created_at <= follow.created_at
              )
            group by 1, 2
          )
          select bucket_date, creator_user_id, sum(published_count), sum(follower_count),
            sum(hide_count), sum(report_count), sum(impression_count),
            sum(profile_open_count), sum(follow_after_view_count), now()
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
          delete from analytics_viewer_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_viewer_daily (
            bucket_date, user_id, feed_impression_count, qualified_view_count,
            credited_watch_seconds, completed_view_count, early_skip_count, replay_count,
            save_count, share_count, hide_count, report_count, app_session_count,
            return_session_count, updated_at
          )
          with playback_sessions as (
            select session.created_at::date as bucket_date, session.user_id, session.id,
              coalesce(sum(heartbeat.credited_seconds), 0)::bigint as credited_seconds,
              max(asset.duration_ms)::bigint as duration_ms
            from platform_playback_sessions session
            left join platform_playback_heartbeats heartbeat on heartbeat.session_id = session.id
            left join content_items content on session.target_type = 'content' and content.id = session.target_id
            left join media_assets asset on asset.content_item_id = content.id and asset.duration_ms is not null
            where session.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3
          ),
          viewer_playback as (
            select bucket_date, user_id,
              count(*) filter (where credited_seconds >= 2) as qualified_views,
              sum(credited_seconds) as watch_seconds,
              count(*) filter (
                where credited_seconds >= 2 and duration_ms is not null
                  and credited_seconds * 1000 >= duration_ms * 0.9
              ) as completed_views,
              count(*) filter (where credited_seconds < 2) as early_skips,
              greatest(count(*) filter (where credited_seconds >= 2) - 1, 0) as replays
            from playback_sessions
            group by 1, 2
          ),
          facts as (
            select receipt.created_at::date as bucket_date, receipt.user_id,
              count(*) as impressions, 0::bigint as qualified_views, 0::bigint as watch_seconds,
              0::bigint as completed_views, 0::bigint as early_skips, 0::bigint as replays,
              0::bigint as saves, 0::bigint as shares, 0::bigint as hides, 0::bigint as reports,
              0::bigint as app_sessions, 0::bigint as return_sessions
            from feed_impression_receipts receipt
            where receipt.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select bucket_date, user_id, 0, qualified_views, watch_seconds, completed_views,
              early_skips, replays, 0, 0, 0, 0, 0, 0
            from viewer_playback
            union all
            select save.created_at::date, save.user_id, 0, 0, 0, 0, 0, 0, count(*), 0, 0, 0, 0, 0
            from content_saves save
            where save.state = 'active'
              and save.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select share.created_at::date, share.actor_user_id, 0, 0, 0, 0, 0, 0, 0, count(*), 0, 0, 0, 0
            from share_records share
            where share.state = 'created'
              and share.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select hidden.created_at::date, hidden.user_id, 0, 0, 0, 0, 0, 0, 0, 0, count(*), 0, 0, 0
            from viewer_hidden_creators hidden
            where hidden.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select report.created_at::date, report.reporter_user_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, count(*), 0, 0
            from reports report
            where report.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
            union all
            select session.created_at::date, session.user_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              count(*), count(*) filter (where session.created_at::date > user_record.created_at::date)
            from app_sessions session
            join users user_record on user_record.id = session.user_id
            where session.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
          )
          select bucket_date, user_id, sum(impressions), sum(qualified_views), sum(watch_seconds),
            sum(completed_views), sum(early_skips), sum(replays), sum(saves), sum(shares),
            sum(hides), sum(reports), sum(app_sessions), sum(return_sessions), now()
          from facts
          group by bucket_date, user_id
        `;

        await transaction`
          delete from analytics_creator_product_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_creator_product_daily (
            bucket_date, creator_user_id, product_type, currency,
            confirmed_purchase_count, confirmed_gross_minor,
            creator_earnings_minor, platform_fee_minor, offer_impression_count,
            membership_start_count, membership_cancel_count, updated_at
          )
          with earnings as (
            select payment_intent_id, account_user_id, sum(amount_minor) as creator_earnings_minor
            from payment_ledger_entries
            where account_kind = 'creator_earning' and state = 'posted' and account_user_id is not null
            group by 1, 2
          ),
          fees as (
            select payment_intent_id, sum(amount_minor) as platform_fee_minor
            from payment_ledger_entries
            where account_kind = 'platform_fee' and state = 'posted'
            group by 1
          ),
          payments as (
            select intent.confirmed_at::date as bucket_date, earning.account_user_id as creator_user_id,
              case when intent.product_type = 'tip' then 'support' else intent.product_type end as product_type,
              intent.currency, count(*) as purchase_count, sum(intent.amount_minor) as gross_minor,
              sum(earning.creator_earnings_minor) as earnings_minor,
              sum(coalesce(fee.platform_fee_minor, 0)) as fee_minor
            from payment_intents intent
            join earnings earning on earning.payment_intent_id = intent.id
            left join fees fee on fee.payment_intent_id = intent.id
            where intent.state = 'confirmed'
              and intent.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and intent.currency in ('SOL', 'USDC')
            group by 1, 2, 3, 4
          ),
          offers as (
            select created_at::date as bucket_date, creator_user_id, product_type, currency,
              count(*) as offer_count
            from analytics_offer_impression_receipts
            where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2, 3, 4
          ),
          membership_events as (
            select first_collection.confirmed_at::date as bucket_date,
              subscription.creator_user_id, 'membership'::text as product_type, plan.currency,
              1::bigint as start_count, 0::bigint as cancel_count
            from subscriptions subscription
            join subscription_plans plan on plan.id = subscription.plan_id
            join (
              select subscription_id, min(confirmed_at) as confirmed_at
              from subscription_collections
              where state = 'confirmed' and confirmed_at is not null
              group by subscription_id
            ) first_collection on first_collection.subscription_id = subscription.id
            where subscription.creator_user_id is not null
              and first_collection.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            union all
            select subscription.cancelled_at::date, subscription.creator_user_id,
              'membership', plan.currency, 0, 1
            from subscriptions subscription
            join subscription_plans plan on plan.id = subscription.plan_id
            where subscription.creator_user_id is not null
              and subscription.cancelled_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
          ),
          memberships as (
            select bucket_date, creator_user_id, product_type, currency,
              sum(start_count) as start_count, sum(cancel_count) as cancel_count
            from membership_events
            group by 1, 2, 3, 4
          ),
          keys as (
            select bucket_date, creator_user_id, product_type, currency from payments
            union select bucket_date, creator_user_id, product_type, currency from offers
            union select bucket_date, creator_user_id, product_type, currency from memberships
          )
          select key.bucket_date, key.creator_user_id, key.product_type, key.currency,
            coalesce(payment.purchase_count, 0), coalesce(payment.gross_minor, 0),
            coalesce(payment.earnings_minor, 0), coalesce(payment.fee_minor, 0),
            coalesce(offer.offer_count, 0), coalesce(membership.start_count, 0),
            coalesce(membership.cancel_count, 0), now()
          from keys key
          left join payments payment using (bucket_date, creator_user_id, product_type, currency)
          left join offers offer using (bucket_date, creator_user_id, product_type, currency)
          left join memberships membership using (bucket_date, creator_user_id, product_type, currency)
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

        await transaction`
          delete from analytics_platform_commerce_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_platform_commerce_daily (
            bucket_date, currency, confirmed_purchase_count, confirmed_gross_minor,
            posted_platform_fee_minor, posted_referral_commission_minor,
            confirmed_management_allocation_minor, updated_at
          )
          with payments as (
            select confirmed_at::date as bucket_date, currency, count(*) as purchase_count,
              sum(amount_minor) as gross_minor
            from payment_intents
            where state = 'confirmed' and currency in ('SOL', 'USDC')
              and confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
          ),
          ledger as (
            select intent.confirmed_at::date as bucket_date, entry.currency,
              sum(entry.amount_minor) filter (where entry.account_kind = 'platform_fee') as platform_fee_minor,
              sum(entry.amount_minor) filter (where entry.account_kind = 'referral_commission') as referral_minor
            from payment_ledger_entries entry
            join payment_intents intent on intent.id = entry.payment_intent_id and intent.state = 'confirmed'
            where entry.state = 'posted'
              and entry.account_kind in ('platform_fee', 'referral_commission')
              and intent.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
          ),
          management as (
            select confirmed_at::date as bucket_date, currency,
              sum(enterprise_management_minor) as management_minor
            from managed_creator_allocation_records
            where state = 'confirmed'
              and confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1, 2
          ),
          keys as (
            select bucket_date, currency from payments
            union select bucket_date, currency from ledger
            union select bucket_date, currency from management
          )
          select key.bucket_date, key.currency, coalesce(payment.purchase_count, 0),
            coalesce(payment.gross_minor, 0), coalesce(ledger_fact.platform_fee_minor, 0),
            coalesce(ledger_fact.referral_minor, 0), coalesce(management_fact.management_minor, 0), now()
          from keys key
          left join payments payment using (bucket_date, currency)
          left join ledger ledger_fact using (bucket_date, currency)
          left join management management_fact using (bucket_date, currency)
        `;

        await transaction`
          delete from analytics_platform_operations_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_platform_operations_daily (
            bucket_date, moderation_job_count, moderation_decision_seconds,
            provider_failure_count, worker_retry_count, worker_dead_letter_count, updated_at
          )
          with queue_facts as (
            select created_at::date as bucket_date, attempt_count, state::text as state from subscription_collections
            union all select created_at::date, attempt_count, state::text from notification_delivery_attempts
            union all select created_at::date, attempt_count, state from payment_confirmation_deliveries
            union all select created_at::date, attempt_count, state from provider_event_replay_requests
            union all select created_at::date, attempt_count, state from media_moderation_jobs
            union all select created_at::date, attempt_count, state from analytics_projection_jobs
          ),
          queues as (
            select bucket_date, sum(greatest(attempt_count - 1, 0)) as retry_count,
              count(*) filter (where state = 'dead_letter') as dead_letter_count
            from queue_facts
            where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1
          ),
          moderation as (
            select created_at::date as bucket_date, count(*) as job_count,
              sum(case when state in ('completed', 'review_required') and updated_at >= created_at
                then floor(extract(epoch from (updated_at - created_at))) else 0 end)::bigint as decision_seconds
            from media_moderation_jobs
            where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1
          ),
          providers as (
            select received_at::date as bucket_date, count(*) as failure_count
            from provider_events
            where normalized_state = 'failed'
              and received_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            group by 1
          ),
          keys as (
            select bucket_date from queues union select bucket_date from moderation union select bucket_date from providers
          )
          select key.bucket_date, coalesce(moderation.job_count, 0),
            coalesce(moderation.decision_seconds, 0), coalesce(provider.failure_count, 0),
            coalesce(queue.retry_count, 0), coalesce(queue.dead_letter_count, 0), now()
          from keys key
          left join queues queue using (bucket_date)
          left join moderation using (bucket_date)
          left join providers provider using (bucket_date)
        `;

        await transaction`
          delete from analytics_retention_daily
          where activity_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_retention_daily (
            activity_date, cohort_date, active_user_count, updated_at
          )
          select session.created_at::date, user_record.created_at::date,
            count(distinct session.user_id), now()
          from app_sessions session
          join users user_record on user_record.id = session.user_id
          where session.created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
            and session.created_at::date >= user_record.created_at::date
          group by 1, 2
        `;

        await transaction`
          delete from analytics_onboarding_daily
          where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
        `;
        await transaction`
          insert into analytics_onboarding_daily (
            bucket_date, event_key, event_count, distinct_journey_count, updated_at
          )
          select occurred_at::date, event_key, count(*), count(distinct journey_id), now()
          from analytics_onboarding_journey_events
          where occurred_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
          group by 1, 2
        `;

        const parityRows = await transaction<{
          source_impressions: string | number;
          projected_impressions: string | number;
          projected_viewer_impressions: string | number;
          source_profile_opens: string | number;
          projected_profile_opens: string | number;
          source_offer_impressions: string | number;
          projected_offer_impressions: string | number;
          source_onboarding_events: string | number;
          projected_onboarding_events: string | number;
          source_purchases: string | number;
          projected_purchases: string | number;
          source_platform_purchases: string | number;
          projected_platform_purchases: string | number;
          source_allocations: string | number;
          projected_allocations: string | number;
          source_provider_failures: string | number;
          projected_provider_failures: string | number;
          projected_table_rows: string | number;
          data_through: Date;
        }[]>`
          select
            (select count(*) from feed_impression_receipts where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_impressions,
            (select coalesce(sum(impression_count), 0) from analytics_creator_content_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_impressions,
            (select coalesce(sum(feed_impression_count), 0) from analytics_viewer_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_viewer_impressions,
            (select count(*) from analytics_profile_open_receipts where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_profile_opens,
            (select coalesce(sum(profile_open_count), 0) from analytics_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_profile_opens,
            (select count(*) from analytics_offer_impression_receipts where created_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_offer_impressions,
            (select coalesce(sum(offer_impression_count), 0) from analytics_creator_product_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_offer_impressions,
            (select count(*) from analytics_onboarding_journey_events where occurred_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_onboarding_events,
            (select coalesce(sum(event_count), 0) from analytics_onboarding_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_onboarding_events,
            (select count(*) from payment_intents intent where intent.state = 'confirmed'
              and intent.confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date
              and exists (select 1 from payment_ledger_entries entry where entry.payment_intent_id = intent.id and entry.account_kind = 'creator_earning' and entry.state = 'posted')) as source_purchases,
            (select coalesce(sum(confirmed_purchase_count), 0) from analytics_creator_product_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_purchases,
            (select count(*) from payment_intents where state = 'confirmed' and confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_platform_purchases,
            (select coalesce(sum(confirmed_purchase_count), 0) from analytics_platform_commerce_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_platform_purchases,
            (select count(*) from managed_creator_allocation_records where state = 'confirmed' and confirmed_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_allocations,
            (select coalesce(sum(confirmed_allocation_count), 0) from analytics_organization_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_allocations,
            (select count(*) from provider_events where normalized_state = 'failed' and received_at::date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as source_provider_failures,
            (select coalesce(sum(provider_failure_count), 0) from analytics_platform_operations_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date) as projected_provider_failures,
            ((select count(*) from analytics_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_creator_content_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_creator_product_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_organization_creator_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_viewer_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_platform_commerce_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_platform_operations_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_retention_daily where activity_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)
             + (select count(*) from analytics_onboarding_daily where bucket_date between ${job.windowStartsOn}::date and ${job.windowEndsOn}::date)) as projected_table_rows,
            least(
              now(),
              ${job.windowEndsOn}::date + interval '1 day' - interval '1 millisecond'
            ) as data_through
        `;
        const parity = parityRows[0];
        const details = {
          sourceImpressions: Number(parity?.source_impressions ?? 0),
          projectedImpressions: Number(parity?.projected_impressions ?? 0),
          projectedViewerImpressions: Number(parity?.projected_viewer_impressions ?? 0),
          sourceProfileOpens: Number(parity?.source_profile_opens ?? 0),
          projectedProfileOpens: Number(parity?.projected_profile_opens ?? 0),
          sourceOfferImpressions: Number(parity?.source_offer_impressions ?? 0),
          projectedOfferImpressions: Number(parity?.projected_offer_impressions ?? 0),
          sourceOnboardingEvents: Number(parity?.source_onboarding_events ?? 0),
          projectedOnboardingEvents: Number(parity?.projected_onboarding_events ?? 0),
          sourcePurchases: Number(parity?.source_purchases ?? 0),
          projectedPurchases: Number(parity?.projected_purchases ?? 0),
          sourcePlatformPurchases: Number(parity?.source_platform_purchases ?? 0),
          projectedPlatformPurchases: Number(parity?.projected_platform_purchases ?? 0),
          sourceAllocations: Number(parity?.source_allocations ?? 0),
          projectedAllocations: Number(parity?.projected_allocations ?? 0),
          sourceProviderFailures: Number(parity?.source_provider_failures ?? 0),
          projectedProviderFailures: Number(parity?.projected_provider_failures ?? 0)
        };
        const sourceRowCount = details.sourceImpressions * 2 + details.sourceProfileOpens
          + details.sourceOfferImpressions + details.sourceOnboardingEvents + details.sourcePurchases
          + details.sourcePlatformPurchases + details.sourceAllocations + details.sourceProviderFailures;
        const projectedRowCount = details.projectedImpressions + details.projectedViewerImpressions
          + details.projectedProfileOpens + details.projectedOfferImpressions
          + details.projectedOnboardingEvents + details.projectedPurchases
          + details.projectedPlatformPurchases + details.projectedAllocations
          + details.projectedProviderFailures;
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
