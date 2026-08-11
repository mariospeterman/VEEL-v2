import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { SubscriptionRepository } from "./types.js";
import { createSubscriptionAuthorizationRepositoryMethods } from "./subscription-authorization-repository.js";
import { createSubscriptionCancellationRepositoryMethods } from "./subscription-cancellation-repository.js";
import { SubscriptionRepositoryConfigurationError } from "./subscription-errors.js";
import {
  toSubscription,
  toSubscriptionPlan
} from "./subscription-repository-mappers.js";
import type { PlanRow, SubscriptionRow } from "./subscription-repository-rows.js";

export {
  SubscriptionIdempotencyConflictError,
  SubscriptionPolicyError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-errors.js";

export function createPostgresSubscriptionRepository(database?: string | PostgresSql): SubscriptionRepository {
  if (!database) {
    return {
      async listPlans() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async listSubscriptions() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async createAuthorizationIntent() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async findAuthorizationVerificationContext() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async submitAuthorization() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async cancel() {
        throw new SubscriptionRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async getPlatformAccess(input) {
      return sql.begin(async (transaction) => {
        const actors = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actors[0];
        if (!actor) throw new SubscriptionRepositoryConfigurationError();

        const tiers = await transaction<PlatformTierRow[]>`
          select
            policy.tier_key,
            policy.label,
            policy.rank,
            policy.monthly_price_minor,
            policy.currency,
            policy.public_media_allowance_seconds,
            policy.subscription_plan_id,
            policy.capabilities,
            plan.state as subscription_plan_state,
            plan.provider_state
          from platform_tier_policies policy
          left join subscription_plans plan on plan.id = policy.subscription_plan_id
          where policy.state = 'active'
          order by policy.rank
        `;
        const freeTier = tiers.find((tier) => tier.tier_key === "free_verified");
        if (!freeTier) throw new SubscriptionRepositoryConfigurationError();

        const candidates = await transaction<{ tier_key: PlatformTierRow["tier_key"] }[]>`
          select policy.tier_key
          from platform_tier_policies policy
          where policy.state = 'active'
            and (
              exists (
                select 1
                from subscriptions subscription
                where subscription.subscriber_user_id = ${actor.id}
                  and subscription.plan_id = policy.subscription_plan_id
                  and subscription.state in ('active', 'renewal_pending', 'grace_period')
                  and (subscription.current_period_ends_at is null or subscription.current_period_ends_at > now())
              )
              or exists (
                select 1
                from tier_waivers waiver
                where waiver.subject_type in ('user', 'creator')
                  and waiver.subject_id = ${actor.id}
                  and waiver.tier_key = policy.tier_key
                  and waiver.state = 'active'
                  and waiver.starts_at <= now()
                  and (waiver.ends_at is null or waiver.ends_at > now())
              )
              or (
                policy.tier_key = 'enterprise'
                and exists (
                  select 1
                  from organization_memberships membership
                  join organizations organization on organization.id = membership.organization_id
                  where membership.user_id = ${actor.id}
                    and membership.state = 'active'
                    and organization.state = 'active'
                    and organization.kyb_state = 'verified'
                )
              )
            )
          order by policy.rank desc
          limit 1
        `;
        const currentTier =
          tiers.find((tier) => tier.tier_key === candidates[0]?.tier_key) ?? freeTier;
        const usageRows = await transaction<PlatformUsageRow[]>`
          select
            window_starts_at,
            window_ends_at,
            public_media_seconds
          from platform_usage_windows
          where user_id = ${actor.id}
            and window_starts_at <= now()
            and window_ends_at > now()
          order by window_starts_at desc
          limit 1
        `;
        const now = new Date();
        const windowStartsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const windowEndsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        const usage = usageRows[0];
        const publicMediaSeconds = Number(usage?.public_media_seconds ?? 0);
        const allowance = nullableNumber(currentTier.public_media_allowance_seconds);
        const remaining = allowance === null ? null : Math.max(0, allowance - publicMediaSeconds);

        return {
          currentTier: toPlatformTier(currentTier),
          usage: {
            windowStartsAt: (usage?.window_starts_at ?? windowStartsAt).toISOString(),
            windowEndsAt: (usage?.window_ends_at ?? windowEndsAt).toISOString(),
            publicMediaSeconds,
            remainingPublicMediaSeconds: remaining,
            limitReached: remaining !== null && remaining === 0
          },
          tiers: tiers.map(toPlatformTier),
          policyBoundary: "platform_tiers_buy_software_and_public_media_allowance_never_social_priority" as const
        };
      });
    },
    async listPlans() {
      const rows = await sql<PlanRow[]>`
        select
          sp.id,
          sp.scope,
          sp.label,
          sp.amount_minor,
          sp.amount_atomic,
          sp.currency,
          sp.period_days,
          sp.period_seconds,
          sp.billing_mode,
          sp.provider_state,
          sp.token_mint,
          sp.token_program,
          sp.provider,
          sp.program_id,
          sp.plan_pda,
          sp.merchant_wallet,
          sp.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscription_plans sp
        left join profiles p on p.user_id = sp.creator_user_id
        where sp.state = 'active'
          and sp.provider_state <> 'disabled'
        order by sp.scope, sp.amount_minor, sp.id
      `;

      return {
        items: rows.map(toSubscriptionPlan)
      };
    },

    async listSubscriptions(input) {
      const rows = await sql<SubscriptionRow[]>`
        select
          s.id,
          s.scope,
          s.plan_id,
          s.state,
          s.renewal_mode,
          s.current_period_ends_at,
          s.next_collection_at,
          s.cancelled_at,
          s.revoked_at,
          s.authority_address,
          s.delegation_address,
          s.subscriber_wallet,
          s.provider,
          s.program_id,
          s.token_mint,
          s.amount_atomic,
          s.period_seconds,
          s.plan_pda,
          s.subscription_pda,
          s.merchant_wallet,
          s.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscriptions s
        join users u on u.id = s.subscriber_user_id
        left join profiles p on p.user_id = s.creator_user_id
        where u.supabase_user_id = ${input.supabaseUserId}
        order by
          case s.state
            when 'active' then 0
            when 'renewal_pending' then 1
            when 'grace_period' then 2
            when 'authorization_pending' then 3
            else 4
          end,
          s.next_collection_at asc nulls last,
          s.created_at desc
      `;

      return {
        items: rows.map(toSubscription)
      };
    },

    ...createSubscriptionAuthorizationRepositoryMethods(sql),
    ...createSubscriptionCancellationRepositoryMethods(sql),

    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

interface PlatformTierRow {
  tier_key: "free_verified" | "veel_plus" | "veel_ultra" | "veel_studio" | "enterprise";
  label: string;
  rank: number;
  monthly_price_minor: string | number | null;
  currency: "USDC" | null;
  public_media_allowance_seconds: string | number | null;
  subscription_plan_id: string | null;
  capabilities: string[];
  subscription_plan_state: "active" | "disabled" | null;
  provider_state: "staging_required" | "launch_approved" | "disabled" | null;
}

interface PlatformUsageRow {
  window_starts_at: Date;
  window_ends_at: Date;
  public_media_seconds: string | number;
}

function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function toPlatformTier(row: PlatformTierRow) {
  const purchaseState = row.tier_key === "free_verified"
    ? "included" as const
    : row.tier_key === "enterprise"
      ? "contact_sales" as const
      : row.subscription_plan_state === "active" && row.provider_state === "launch_approved"
        ? "available" as const
        : "unavailable" as const;

  return {
    key: row.tier_key,
    label: row.label,
    rank: row.rank,
    monthlyPriceMinor: nullableNumber(row.monthly_price_minor),
    currency: row.currency,
    publicMediaAllowanceSeconds: nullableNumber(row.public_media_allowance_seconds),
    capabilities: row.capabilities,
    purchaseState,
    subscriptionPlanId: row.subscription_plan_id
  };
}
