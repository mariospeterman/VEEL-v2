import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  CountRow,
  NotificationHealthRow,
  WorkerQueueHealthRow,
  AdminUserRow,
  pageSize,
  page,
  toCounts,
  toNotificationHealth,
  toWorkerQueueHealth,
  toAdminUser
} from "./admin-repository-mappers.js";

export function createAccessRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "hasAdminAccess" | "getOpsSummary" | "getNotificationHealth" | "retryDeadLetterJob" | "listUsers" | "getUser"> {
  return {
    async hasAdminAccess(supabaseUserId) {
      const rows = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1
          from users u
          join staff_memberships sm on sm.user_id = u.id
          where u.supabase_user_id = ${supabaseUserId}
            and u.state = 'active'
            and sm.state = 'active'
            and sm.role in ('owner', 'admin', 'trust_safety', 'finance', 'ops', 'support', 'creator_success', 'event_ops', 'ai_ops', 'readonly_auditor')
        ) as allowed
      `;

      return Boolean(rows[0]?.allowed);
    },
    async getOpsSummary() {
      const [
        paymentRows,
        unlockRows,
        providerRows,
        subscriptionRows,
        subscriptionProviderRows,
        organizationRows,
        managedCreatorRows,
        enterpriseAllocationRows,
        creatorMediaOfferRows,
        structuredCreatorRequestRows,
        reportRows,
        workerQueueRows
      ] = await Promise.all([
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where state in ('pending', 'transaction_requested')) as pending,
            count(*) filter (where state = 'submitted') as submitted,
            count(*) filter (where state = 'confirmed') as confirmed,
            count(*) filter (where state in ('failed', 'expired')) as failed
          from payment_intents
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            0 as pending,
            0 as submitted,
            count(*) filter (where state = 'active') as confirmed,
            count(*) filter (where state in ('expired', 'revoked')) as failed
          from entitlements
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where normalized_state = 'received') as pending,
            0 as submitted,
            count(*) filter (where normalized_state in ('processed', 'replayed', 'ignored')) as confirmed,
            count(*) filter (where normalized_state = 'failed') as failed
          from provider_events
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where state in ('authorization_pending', 'renewal_pending', 'grace_period')) as pending,
            count(*) filter (where state = 'renewal_pending') as submitted,
            count(*) filter (where state = 'active') as confirmed,
            count(*) filter (where state in ('cancelled', 'suspended', 'expired', 'revoked')) as failed
          from subscriptions
        `,
        sql<{ launch_approved: boolean; staging_required: boolean }[]>`
          select
            exists (select 1 from subscription_plans where provider_state = 'launch_approved' and state = 'active') as launch_approved,
            exists (select 1 from subscription_plans where provider_state = 'staging_required') as staging_required
        `,
        sql<CountRow[]>`
          select count(*) as total,
            count(*) filter (where state = 'pending_kyb') as pending,
            0 as submitted,
            count(*) filter (where state = 'active') as confirmed,
            count(*) filter (where state in ('suspended', 'archived')) as failed
          from organizations
        `,
        sql<CountRow[]>`
          select count(*) as total,
            count(*) filter (where state = 'invited') as pending,
            count(*) filter (where state = 'active' and exists (
              select 1 from managed_creator_agreements agreement
              where agreement.relationship_id = managed_creator_relationships.id and agreement.state = 'proposed'
            )) as submitted,
            count(*) filter (where state = 'active' and exists (
              select 1 from managed_creator_agreements agreement
              where agreement.relationship_id = managed_creator_relationships.id and agreement.state = 'accepted'
            )) as confirmed,
            count(*) filter (where state in ('declined', 'suspended', 'terminated', 'expired')) as failed
          from managed_creator_relationships
        `,
        sql<CountRow[]>`
          select count(*) as total,
            count(*) filter (where state = 'pending') as pending,
            0 as submitted,
            count(*) filter (where state = 'confirmed') as confirmed,
            count(*) filter (where state in ('failed', 'reversed')) as failed
          from managed_creator_allocation_records
        `,
        sql<CountRow[]>`
          select count(*) as total,
            count(*) filter (where state = 'offered') as pending,
            count(*) filter (where state = 'accepted') as submitted,
            count(*) filter (where state = 'purchased') as confirmed,
            count(*) filter (where state in ('declined', 'withdrawn', 'expired', 'remediation')) as failed
          from creator_media_offers
        `,
        sql<CountRow[]>`
          select count(*) as total,
            count(*) filter (where state in ('proposed', 'terms_proposed')) as pending,
            count(*) filter (where state in ('accepted', 'payment_pending')) as submitted,
            count(*) filter (where state in ('active', 'delivered', 'completed')) as confirmed,
            count(*) filter (where state in ('declined', 'remediation', 'cancelled', 'expired')) as failed
          from structured_creator_requests
        `,
        sql<{ open_reports: string | number }[]>`
          select 0 as open_reports
        `,
        sql<WorkerQueueHealthRow[]>`
          select
            'subscription_collections'::text as name,
            count(*) filter (where state in ('due', 'failed')) as pending_count,
            count(*) filter (where state = 'processing') as processing_count,
            count(*) filter (where state = 'failed') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('due', 'failed')) as oldest_pending_at
          from subscription_collections
          union all
          select
            'notification_deliveries'::text as name,
            count(*) filter (where state in ('queued', 'failed')) as pending_count,
            count(*) filter (where state = 'leased') as processing_count,
            count(*) filter (where state = 'failed') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('queued', 'failed')) as oldest_pending_at
          from notification_delivery_attempts
          union all
          select
            'payment_confirmation_emails'::text as name,
            count(*) filter (where state in ('queued', 'provider_not_configured', 'failed')) as pending_count,
            count(*) filter (where state = 'processing') as processing_count,
            count(*) filter (where state = 'failed') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (
              where state in ('queued', 'provider_not_configured', 'failed')
            ) as oldest_pending_at
          from payment_confirmation_deliveries
          union all
          select
            'provider_event_replays'::text as name,
            count(*) filter (where state in ('queued', 'failed')) as pending_count,
            count(*) filter (where state = 'processing') as processing_count,
            count(*) filter (where state = 'failed') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('queued', 'failed')) as oldest_pending_at
          from provider_event_replay_requests
          union all
          select
            'media_moderation'::text as name,
            count(*) filter (where state in ('queued', 'retry')) as pending_count,
            count(*) filter (where state = 'processing') as processing_count,
            count(*) filter (where state = 'retry') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('queued', 'retry')) as oldest_pending_at
          from media_moderation_jobs
          union all
          select
            'analytics_projections'::text as name,
            count(*) filter (where state in ('queued', 'retry')) as pending_count,
            count(*) filter (where state = 'leased') as processing_count,
            count(*) filter (where state = 'retry') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('queued', 'retry')) as oldest_pending_at
          from analytics_projection_jobs
          union all
          select
            'live_safety'::text as name,
            count(*) filter (where state in ('queued', 'retry')) as pending_count,
            count(*) filter (where state = 'processing') as processing_count,
            count(*) filter (where state = 'retry') as failed_count,
            count(*) filter (where state = 'dead_letter') as dead_letter_count,
            min(next_attempt_at) filter (where state in ('queued', 'retry')) as oldest_pending_at
          from live_safety_provider_actions
        `
      ]);

      const providerCounts = toCounts(providerRows[0]);
      const subscriptionProvider = subscriptionProviderRows[0];
      const workerQueues = workerQueueRows.map(toWorkerQueueHealth);
      const queueHealth = workerQueues.some((queue) => queue.failedCount > 0 || queue.deadLetterCount > 0)
        ? "degraded"
        : "ok";

      return {
        providerHealth: providerCounts.failed > 0 ? "degraded" : "ok",
        queueHealth,
        workerQueues,
        openReports: Number(reportRows[0]?.open_reports ?? 0),
        paymentCounts: toCounts(paymentRows[0]),
        unlockCounts: toCounts(unlockRows[0]),
        providerEventCounts: providerCounts,
        subscriptionCounts: toCounts(subscriptionRows[0]),
        organizationCounts: toCounts(organizationRows[0]),
        managedCreatorCounts: toCounts(managedCreatorRows[0]),
        enterpriseAllocationCounts: toCounts(enterpriseAllocationRows[0]),
        creatorMediaOfferCounts: toCounts(creatorMediaOfferRows[0]),
        structuredCreatorRequestCounts: toCounts(structuredCreatorRequestRows[0]),
        subscriptionProviderReadiness: subscriptionProvider?.launch_approved
          ? "launch_approved"
          : subscriptionProvider?.staging_required
            ? "staging_required"
            : "not_configured"
      };
    },
    async getNotificationHealth() {
      const rows = await sql<NotificationHealthRow[]>`
        select
          (select count(*) from notifications where state = 'unread') as unread_count,
          (select count(*) from notifications where state = 'read') as read_count,
          (select count(*) from notifications where state = 'archived') as archived_count,
          (select count(*) from notification_devices where state = 'active') as active_device_count,
          (select count(*) from notification_devices where state = 'revoked') as revoked_device_count,
          (select count(*) from notification_preferences where push_enabled) as push_enabled_preference_count,
          (select count(*) from notification_delivery_attempts where state = 'queued') as queued_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'leased') as leased_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'delivered') as delivered_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'failed') as failed_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'dead_letter') as dead_letter_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'skipped') as skipped_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'revoked') as revoked_delivery_count,
          (select max(created_at) from notifications) as latest_notification_at,
          (select max(last_seen_at) from notification_devices) as latest_device_seen_at,
          (select max(delivered_at) from notification_delivery_attempts) as latest_delivery_at
      `;

      return toNotificationHealth(rows[0]);
    },
    async retryDeadLetterJob(input) {
      const reason = input.body.reason.trim();
      const run = async (
        table: string,
        queuedState: string,
        stateType: "text" | "notification_delivery_state" = "text",
        failureColumn = "failure_code",
        leaseExpiryColumn = "leased_until"
      ) => {
        const queuedStateSql = stateType === "notification_delivery_state"
          ? sql`${queuedState}::notification_delivery_state`
          : sql`${queuedState}::text`;
        const rows = await sql<{ accepted: boolean }[]>`
          with actor as (
            select u.id
            from users u
            join staff_memberships sm on sm.user_id = u.id
            where u.supabase_user_id = ${input.supabaseUserId}::uuid
              and u.state = 'active'
              and sm.state = 'active'
              and sm.role in ('owner', 'admin', 'ops')
          ),
          existing_request as (
            select id
            from worker_queue_recovery_requests
            where queue_name = ${input.queueName}
              and job_id = ${input.jobId}::uuid
              and idempotency_key = ${input.idempotencyKey}
          ),
          target as (
            select id
            from ${sql(table)}
            where id = ${input.jobId}::uuid
              and state = 'dead_letter'
          ),
          request_insert as (
            insert into worker_queue_recovery_requests (
              id,
              queue_name,
              job_id,
              requested_by_user_id,
              idempotency_key,
              reason
            )
            select
              gen_random_uuid(),
              ${input.queueName},
              target.id,
              actor.id,
              ${input.idempotencyKey},
              ${reason}
            from target
            cross join actor
            on conflict (queue_name, job_id, idempotency_key) do nothing
            returning id
          ),
          recovered as (
            update ${sql(table)}
            set
              state = ${queuedStateSql},
              attempt_count = 0,
              lease_token = null,
              ${sql(leaseExpiryColumn)} = null,
              next_attempt_at = now(),
              ${sql(failureColumn)} = null
            where id in (select id from target)
              and exists (select 1 from request_insert)
            returning id
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'worker_queue_job',
              recovered.id,
              'worker_queue.dead_letter_retried',
              jsonb_build_object(
                'queueName', ${input.queueName}::text,
                'reason', ${reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text
              )
            from recovered
            cross join actor
            returning id
          )
          select
            exists(select 1 from recovered) or exists(select 1 from existing_request) as accepted
        `;

        return rows[0]?.accepted ?? false;
      };

      switch (input.queueName) {
        case "subscription_collections":
          return run("subscription_collections", "due");
        case "notification_deliveries":
          return run("notification_delivery_attempts", "queued", "notification_delivery_state");
        case "payment_confirmation_emails":
          return run("payment_confirmation_deliveries", "queued");
        case "provider_event_replays":
          return run("provider_event_replay_requests", "queued");
        case "media_moderation":
          return run("media_moderation_jobs", "queued");
        case "analytics_projections":
          return run("analytics_projection_jobs", "queued", "text", "last_error_code");
        case "live_safety":
          return run(
            "live_safety_provider_actions",
            "queued",
            "text",
            "last_failure_code",
            "lease_expires_at"
          );
      }
    },
    async listUsers(input) {
      const rows = await sql<AdminUserRow[]>`
        select
          u.id,
          p.handle,
          u.state,
          coalesce(latest_age.state::text, 'required') as age_state,
          primary_wallet.address is not null as wallet_connected,
          primary_wallet.chain::text as wallet_chain,
          primary_wallet.address as wallet_address,
          u.created_at
        from users u
        join profiles p on p.user_id = u.id
        left join lateral (
          select case
            when status = 'valid' and (expires_at is null or expires_at > now()) then 'verified'
            when status = 'pending' then 'pending'
            else 'failed'
          end as state
          from verification_records
          where subject_type = 'user'
            and subject_id = u.id
            and purpose = 'age_access'
          order by created_at desc, id desc
          limit 1
        ) latest_age on true
        left join lateral (
          select chain, address
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at desc
          limit 1
        ) primary_wallet on true
        where (${input.cursor ?? null}::timestamptz is null or u.created_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or p.handle ilike '%' || ${input.query ?? ""} || '%'
            or u.id::text = ${input.query ?? ""}
          )
        order by u.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminUser);
    },
    async getUser(input) {
      const rows = await sql<AdminUserRow[]>`
        select
          u.id,
          p.handle,
          u.state,
          coalesce(latest_age.state::text, 'required') as age_state,
          primary_wallet.address is not null as wallet_connected,
          primary_wallet.chain::text as wallet_chain,
          primary_wallet.address as wallet_address,
          u.created_at
        from users u
        join profiles p on p.user_id = u.id
        left join lateral (
          select case
            when status = 'valid' and (expires_at is null or expires_at > now()) then 'verified'
            when status = 'pending' then 'pending'
            else 'failed'
          end as state
          from verification_records
          where subject_type = 'user'
            and subject_id = u.id
            and purpose = 'age_access'
          order by created_at desc, id desc
          limit 1
        ) latest_age on true
        left join lateral (
          select chain, address
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at desc
          limit 1
        ) primary_wallet on true
        where u.id = ${input.userId}
        limit 1
      `;

      return rows[0] ? toAdminUser(rows[0]) : null;
    },
  };
}
