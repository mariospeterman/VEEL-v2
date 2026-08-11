import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  CountRow,
  NotificationHealthRow,
  AdminUserRow,
  pageSize,
  page,
  toCounts,
  toNotificationHealth,
  toAdminUser
} from "./admin-repository-mappers.js";

export function createAccessRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "hasAdminAccess" | "getOpsSummary" | "getNotificationHealth" | "listUsers" | "getUser"> {
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
            and sm.role in ('owner', 'admin', 'finance', 'ops', 'support', 'creator_success', 'readonly_auditor')
        ) as allowed
      `;

      return Boolean(rows[0]?.allowed);
    },
    async getOpsSummary() {
      const [paymentRows, unlockRows, providerRows, reportRows] = await Promise.all([
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
        sql<{ open_reports: string | number }[]>`
          select 0 as open_reports
        `
      ]);

      const providerCounts = toCounts(providerRows[0]);

      return {
        providerHealth: providerCounts.failed > 0 ? "degraded" : "ok",
        queueHealth: "ok",
        openReports: Number(reportRows[0]?.open_reports ?? 0),
        paymentCounts: toCounts(paymentRows[0]),
        unlockCounts: toCounts(unlockRows[0]),
        providerEventCounts: providerCounts
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
          (select count(*) from notification_delivery_attempts where state = 'skipped') as skipped_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'revoked') as revoked_delivery_count,
          (select max(created_at) from notifications) as latest_notification_at,
          (select max(last_seen_at) from notification_devices) as latest_device_seen_at,
          (select max(delivered_at) from notification_delivery_attempts) as latest_delivery_at
      `;

      return toNotificationHealth(rows[0]);
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
