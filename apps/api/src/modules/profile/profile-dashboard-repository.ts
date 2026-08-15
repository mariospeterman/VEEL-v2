import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  CreatorOnboardingIdempotencyConflictError,
  CreatorOnboardingTermsRequiredError,
  CreatorOnboardingWalletConflictError
} from "./profile-errors.js";
import { toCreatorDashboard, toCreatorOnboarding } from "./profile-repository-mappers.js";
import type {
  CreatorOnboardingRow,
  DashboardRow,
  EarningsRow,
  ProductRow,
  RecentPaymentRow
} from "./profile-repository-rows.js";
import type { CreatorOnboardingResource, ProfileRepository } from "./types.js";

export function createProfileDashboardRepositoryMethods(
  sql: postgres.Sql
): Pick<
  ProfileRepository,
  "getMyCreatorDashboard" | "getMyCreatorOnboarding" | "updateMyCreatorOnboarding"
> {
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
          es.earnings_terms_version,
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
            when vr.status = 'valid' and vr.result_over_threshold is true
              and (vr.expires_at is null or vr.expires_at > now()) then 'verified'
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
    },
    async updateMyCreatorOnboarding(input) {
      if (
        input.request.earningsTermsAccepted !== true ||
        input.request.earningsTermsVersion !== "wevid-creator-earnings-v1"
      ) {
        throw new CreatorOnboardingTermsRequiredError();
      }

      return sql.begin(async (transaction) => {
        const identityRows = await transaction<{ id: string; state: string }[]>`
          select id, state
          from users
          where supabase_user_id = ${input.supabaseUserId}
          for update
        `;
        const identity = identityRows[0];
        if (!identity) {
          return null;
        }

        const receiptRows = await transaction<{
          request_hash: string;
          response_body: CreatorOnboardingResource;
        }[]>`
          select request_hash, response_body
          from creator_onboarding_action_receipts
          where actor_user_id = ${identity.id}
            and idempotency_key = ${input.idempotencyKey}
        `;
        const receipt = receiptRows[0];
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) {
            throw new CreatorOnboardingIdempotencyConflictError();
          }
          return receipt.response_body;
        }

        const walletRows = await transaction<{ id: string }[]>`
          select id
          from wallets
          where id = ${input.request.recipientWalletId}
            and user_id = ${identity.id}
            and chain = ${input.expectedWalletChain}
          for share
        `;
        if (!walletRows[0]) {
          throw new CreatorOnboardingWalletConflictError();
        }

        await transaction`
          insert into creator_monetisation_settings (user_id)
          values (${identity.id})
          on conflict (user_id) do nothing
        `;

        const policyRows = await transaction<{
          effective_kyc_mode: "disabled" | "risk_based" | "required";
        }[]>`
          select case
            when rmo.kyc_requirement = 'required' then 'required'
            when rmo.kyc_requirement = 'not_required' then 'disabled'
            when rmp.kyc_mode = 'required' then 'required'
            else rmp.kyc_mode
          end as effective_kyc_mode
          from recipient_monetisation_policies rmp
          left join recipient_monetisation_overrides rmo
            on rmo.user_id = ${identity.id}
           and rmo.effective_at <= now()
           and (rmo.expires_at is null or rmo.expires_at > now())
          where rmp.policy_key = 'default'
            and rmp.effective_at <= now()
          limit 1
        `;
        const effectiveKycMode = policyRows[0]?.effective_kyc_mode ?? "required";

        const kycRows = await transaction<{
          status: string;
          assurance_level: string;
          expires_at: Date | null;
        }[]>`
          select status, assurance_level, expires_at
          from verification_records
          where subject_type = 'user'
            and subject_id = ${identity.id}
            and purpose = 'creator_kyc'
          order by created_at desc, id desc
          limit 1
        `;
        const kyc = kycRows[0];
        const kycState: CreatorOnboardingRow["kyc_state"] =
          effectiveKycMode !== "required"
            ? "not_required"
            : kyc?.status === "valid" &&
                (kyc.assurance_level === "high" || kyc.assurance_level === "documentary") &&
                (!kyc.expires_at || kyc.expires_at > new Date())
              ? "verified"
              : kyc?.status === "pending"
                ? "pending"
                : kyc?.status === "invalid" || kyc?.status === "blocked"
                  ? "failed"
                  : "required";

        const readinessRows = await transaction<{
          has_profile: boolean;
          age_verified: boolean;
          tax_profile_state: CreatorOnboardingRow["tax_profile_state"];
          settings_state: CreatorOnboardingRow["state"];
        }[]>`
          select
            (p.handle is not null) as has_profile,
            exists (
              select 1 from verification_records vr
              where vr.subject_type = 'user'
                and vr.subject_id = u.id
                and vr.purpose = 'age_access'
                and vr.status = 'valid'
                and vr.result_over_threshold is true
                and (vr.expires_at is null or vr.expires_at > now())
            ) as age_verified,
            cms.tax_profile_state,
            cms.state as settings_state
          from users u
          left join profiles p on p.user_id = u.id
          join creator_monetisation_settings cms on cms.user_id = u.id
          where u.id = ${identity.id}
        `;
        const readiness = readinessRows[0];
        if (!readiness) {
          return null;
        }
        const productsEnabled = Object.values(input.request.products).some(Boolean);
        const compliancePending = kycState === "pending" || readiness.tax_profile_state === "pending";
        const complianceBlocked =
          kycState === "failed" ||
          readiness.settings_state === "blocked" ||
          identity.state !== "active";
        const complianceReady =
          (kycState === "not_required" || kycState === "verified") &&
          (readiness.tax_profile_state === "not_required" ||
            readiness.tax_profile_state === "verified");
        const earningState: CreatorOnboardingRow["earning_state"] = complianceBlocked
          ? "held"
          : compliancePending
            ? "review_required"
            : readiness.has_profile && readiness.age_verified && productsEnabled && complianceReady
              ? "ready"
              : "not_configured";

        await transaction`
          update creator_monetisation_settings
          set earnings_recipient_wallet_id = ${input.request.recipientWalletId},
              earnings_terms_version = ${input.request.earningsTermsVersion},
              earnings_terms_accepted_at = case
                when earnings_terms_version is distinct from ${input.request.earningsTermsVersion}
                  or earnings_terms_accepted_at is null
                then now()
                else earnings_terms_accepted_at
              end,
              support_enabled = ${input.request.products.support},
              content_unlocks_enabled = ${input.request.products.contentUnlocks},
              live_passes_enabled = ${input.request.products.eventAccessAndLive},
              paid_messages_enabled = ${input.request.products.paidMessages},
              kyc_state = ${kycState},
              earning_state = ${earningState},
              updated_at = now()
          where user_id = ${identity.id}
        `;

        const updatedRows = await transaction<CreatorOnboardingRow[]>`
          select
            u.id,
            p.handle,
            p.display_name,
            latest_age.state as age_state,
            primary_wallet.id as primary_wallet_id,
            (select count(*) from wallets w where w.user_id = u.id) as wallet_count,
            es.state,
            es.earning_state,
            es.kyc_state,
            es.tax_profile_state,
            es.earnings_recipient_wallet_id,
            es.earnings_terms_version,
            es.support_enabled,
            es.content_unlocks_enabled,
            es.live_passes_enabled,
            es.paid_messages_enabled,
            es.subscriptions_enabled
          from creator_monetisation_settings es
          join users u on u.id = es.user_id
          left join profiles p on p.user_id = u.id
          left join lateral (
            select case
              when vr.status = 'valid' and vr.result_over_threshold is true
                and (vr.expires_at is null or vr.expires_at > now()) then 'verified'
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
            select w.id from wallets w
            where w.user_id = u.id
            order by w.is_primary desc, w.created_at asc
            limit 1
          ) primary_wallet on true
          where u.id = ${identity.id}
        `;
        const updated = updatedRows[0];
        if (!updated) {
          return null;
        }
        const response = toCreatorOnboarding(updated);

        await transaction`
          insert into creator_onboarding_action_receipts (
            actor_user_id, idempotency_key, request_hash, response_body
          ) values (
            ${identity.id}, ${input.idempotencyKey}, ${input.requestHash},
            ${transaction.json(response)}
          )
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          ) values (
            ${randomUUID()}, ${identity.id}, 'creator_monetisation', ${identity.id},
            'creator_earnings_configuration_updated', ${input.idempotencyKey},
            ${transaction.json({
              earningsTermsVersion: input.request.earningsTermsVersion,
              enabledProducts: Object.entries(input.request.products)
                .filter(([, enabled]) => enabled)
                .map(([product]) => product),
              earningState,
              kycState
            })}
          )
        `;

        return response;
      });
    }
  };
}
