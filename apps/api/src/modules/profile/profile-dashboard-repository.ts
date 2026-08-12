import type postgres from "postgres";
import { toCreatorDashboard, toCreatorOnboarding } from "./profile-repository-mappers.js";
import type {
  CreatorOnboardingRow,
  DashboardRow,
  EarningsRow,
  ProductRow,
  RecentPaymentRow
} from "./profile-repository-rows.js";
import type { ProfileRepository } from "./types.js";

export function createProfileDashboardRepositoryMethods(
  sql: postgres.Sql
): Pick<ProfileRepository, "getMyCreatorDashboard" | "getMyCreatorOnboarding"> {
  return {
    async getMyCreatorDashboard(supabaseUserId) {
      const dashboardRows = await sql<DashboardRow[]>`
        with target_user as (
          select u.id
          from users u
          where u.supabase_user_id = ${supabaseUserId}
          limit 1
        ),
        ensured_settings as (
          insert into creator_monetisation_settings (user_id)
          select id from target_user
          on conflict (user_id) do update set updated_at = creator_monetisation_settings.updated_at
          returning *
        )
        select
          u.id,
          p.handle,
          p.display_name,
          p.avatar_url,
          es.state,
          es.earning_state,
          es.kyc_state,
          es.tax_profile_state,
          case when es.earnings_recipient_wallet_id is null then 'missing' else 'linked' end as recipient_wallet_state,
          es.support_enabled,
          es.content_unlocks_enabled,
          es.live_passes_enabled,
          es.paid_messages_enabled,
          es.subscriptions_enabled
        from ensured_settings es
        join users u on u.id = es.user_id
        join profiles p on p.user_id = u.id
        limit 1
      `;
      const dashboard = dashboardRows[0];

      if (!dashboard) {
        return null;
      }

      const [earningsRows, productRows, recentPaymentRows] = await Promise.all([
        sql<EarningsRow[]>`
          with creator_payments as (
            select distinct payment_intent_id
            from payment_ledger_entries
            where account_user_id = ${dashboard.id}
              and account_kind = 'creator_earning'
          )
          select
            (
              select coalesce(sum(amount_minor), 0)
              from payment_ledger_entries
              where account_user_id = ${dashboard.id}
                and account_kind = 'creator_earning'
                and state = 'posted'
            ) as creator_earnings_minor,
            (
              select coalesce(sum(ple.amount_minor), 0)
              from payment_ledger_entries ple
              join creator_payments cp on cp.payment_intent_id = ple.payment_intent_id
              where ple.account_kind = 'platform_fee'
                and ple.state = 'posted'
            ) as platform_fees_minor,
            (
              select coalesce(sum(amount_minor), 0)
              from referral_commissions
              where referrer_user_id = ${dashboard.id}
                and state in ('pending', 'posted', 'earned')
            ) as referral_commissions_minor,
            (
              select count(*)
              from creator_payments
            ) as confirmed_payment_count
        `,
        sql<ProductRow[]>`
          with creator_targets as (
            select id from content_items where creator_user_id = ${dashboard.id}
            union
            select id from live_rooms where creator_user_id = ${dashboard.id}
            union
            select ${dashboard.id}::uuid as id
          )
          select
            case when pi.product_type = 'tip' then 'support' else pi.product_type end as product_type,
            coalesce(sum(pi.amount_minor), 0) as amount_minor,
            count(*) as confirmed_payment_count
          from payment_intents pi
          join creator_targets ct on ct.id = pi.target_id
          where pi.state = 'confirmed'
          group by case when pi.product_type = 'tip' then 'support' else pi.product_type end
          order by case when pi.product_type = 'tip' then 'support' else pi.product_type end
        `,
        sql<RecentPaymentRow[]>`
          with creator_targets as (
            select id from content_items where creator_user_id = ${dashboard.id}
            union
            select id from live_rooms where creator_user_id = ${dashboard.id}
            union
            select ${dashboard.id}::uuid as id
          )
          select
            pi.id,
            pi.product_type,
            pi.target_id,
            pi.amount_minor,
            pi.currency,
            pi.state,
            pi.confirmed_signature,
            pi.reference_address,
            pi.created_at,
            pi.confirmed_at
          from payment_intents pi
          join creator_targets ct on ct.id = pi.target_id
          order by pi.created_at desc
          limit 10
        `
      ]);

      return toCreatorDashboard(dashboard, earningsRows[0], productRows, recentPaymentRows);
    },
    async getMyCreatorOnboarding(supabaseUserId) {
      const rows = await sql<CreatorOnboardingRow[]>`
        with target_user as (
          select u.id
          from users u
          where u.supabase_user_id = ${supabaseUserId}
          limit 1
        ),
        ensured_settings as (
          insert into creator_monetisation_settings (user_id)
          select id from target_user
          on conflict (user_id) do update set updated_at = creator_monetisation_settings.updated_at
          returning *
        )
        select
          u.id,
          p.handle,
          p.display_name,
          latest_age.state as age_state,
          primary_wallet.id as primary_wallet_id,
          (
            select count(*)
            from wallets w
            where w.user_id = u.id
          ) as wallet_count,
          es.state,
          es.earning_state,
          es.kyc_state,
          es.tax_profile_state,
          es.earnings_recipient_wallet_id,
          es.support_enabled,
          es.content_unlocks_enabled,
          es.live_passes_enabled,
          es.paid_messages_enabled,
          es.subscriptions_enabled
        from ensured_settings es
        join users u on u.id = es.user_id
        left join profiles p on p.user_id = u.id
        left join lateral (
          select case
            when vr.status = 'valid' and (vr.expires_at is null or vr.expires_at > now()) then 'verified'
            when vr.status = 'pending' then 'pending'
            else 'failed'
          end as state
          from verification_records vr
          where vr.subject_type = 'user'
            and vr.subject_id = u.id
            and vr.purpose = 'age_access'
          order by vr.created_at desc, vr.id desc
          limit 1
        ) latest_age on true
        left join lateral (
          select w.id
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at asc
          limit 1
        ) primary_wallet on true
        limit 1
      `;
      const row = rows[0];

      return row ? toCreatorOnboarding(row) : null;
    }
  };
}
