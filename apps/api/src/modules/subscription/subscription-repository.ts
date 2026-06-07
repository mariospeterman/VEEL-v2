import postgres from "postgres";
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

export function createPostgresSubscriptionRepository(databaseUrl?: string): SubscriptionRepository {
  if (!databaseUrl) {
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

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listPlans() {
      const rows = await sql<PlanRow[]>`
        select
          sp.id,
          sp.scope,
          sp.label,
          sp.amount_minor,
          sp.currency,
          sp.period_days,
          sp.billing_mode,
          sp.provider_state,
          sp.token_mint,
          sp.token_program,
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
      await sql.end({ timeout: 5 });
    }
  };
}
