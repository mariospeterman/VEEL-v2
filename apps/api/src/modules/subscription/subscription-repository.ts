import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import {
  bindCursorScope,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import type { SubscriptionRepository } from "./types.js";
import { createSubscriptionAuthorizationRepositoryMethods } from "./subscription-authorization-repository.js";
import { createSubscriptionCancellationRepositoryMethods } from "./subscription-cancellation-repository.js";
import { createPlatformAccessRepositoryMethods } from "./platform-access-repository.js";
import { createCreatorMembershipOfferRepositoryMethods } from "./creator-membership-offer-repository.js";
import { SubscriptionRepositoryConfigurationError } from "./subscription-errors.js";
import {
  toSubscription,
  toSubscriptionPlan
} from "./subscription-repository-mappers.js";
import type { PlanRow, SubscriptionRow } from "./subscription-repository-rows.js";
import {
  decodeSubscriptionPlanCursor,
  encodeSubscriptionPlanCursor
} from "./subscription-pagination.js";

const subscriptionCursorScope = "GET /v1/subscriptions";

export {
  PlatformPlaybackNotQualifyingError,
  PlatformUsageLimitReachedError,
  PlatformUsageSequenceConflictError,
  SubscriptionIdempotencyConflictError,
  SubscriptionCollectionInFlightError,
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
      async getCreatorOffer() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async upsertCreatorOffer() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async disableCreatorOffer() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async getPlatformAccess() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async getPlatformPlaybackDecision() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async createPlatformPlaybackSession() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async recordPlatformPlaybackHeartbeat() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async createAuthorizationIntent() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async findAuthorizationVerificationContext() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async recordAuthorizationTransactionFacts() {
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
    ...createPlatformAccessRepositoryMethods(sql),
    ...createCreatorMembershipOfferRepositoryMethods(sql),
    async listPlans(input) {
      const planIdCursor = decodeSubscriptionPlanCursor(input.cursor);
      const rows = await sql<PlanRow[]>`
        select
          sp.id,
          sp.scope,
          sp.label,
          sp.description,
          sp.benefits,
          sp.price_minor as amount_minor,
          sp.asset_decimals,
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
          sp.creator_amount_atomic,
          sp.platform_fee_amount_atomic,
          sp.allocation_amount_atomic,
          sp.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscription_plans sp
        left join profiles p on p.user_id = sp.creator_user_id
        where sp.scope = 'platform'
          and sp.state = 'active'
          and sp.provider_state <> 'disabled'
          and (${planIdCursor}::text is null or sp.id > ${planIdCursor}::text)
        order by sp.id asc
        limit ${input.limit + 1}
      `;

      return keysetPage(
        rows,
        input.limit,
        toSubscriptionPlan,
        (row) => encodeSubscriptionPlanCursor(row.id)
      );
    },

    async listSubscriptions(input) {
      const cursorScope = bindCursorScope(subscriptionCursorScope, {
        actor: input.supabaseUserId,
        scope: input.scope ?? "all",
        sort: "created_at:desc,id:desc",
        view: input.view
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<SubscriptionRow[]>`
        select
          s.id,
          s.created_at,
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
          s.subscriber_token_account,
          s.provider,
          s.program_id,
          s.token_mint,
          s.amount_atomic,
          s.period_seconds,
          s.plan_pda,
          s.subscription_pda,
          s.failure_reason,
          s.merchant_wallet,
          s.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscriptions s
        join users u on u.id = s.subscriber_user_id
        left join profiles p on p.user_id = s.creator_user_id
        where u.supabase_user_id = ${input.supabaseUserId}
          and (${input.scope ?? null}::text is null or s.scope = ${input.scope ?? null}::text)
          and (
            (${input.view}::text = 'active' and s.state in (
              'authorization_pending', 'active', 'renewal_pending', 'grace_period'
            ))
            or (${input.view}::text = 'history' and s.state in (
              'cancelled', 'suspended', 'expired', 'revoked'
            ))
          )
          and (
            ${cursor.timestamp}::timestamptz is null
            or s.created_at < ${cursor.timestamp}::timestamptz
            or (
              s.created_at = ${cursor.timestamp}::timestamptz
              and (${cursor.id}::uuid is null or s.id < ${cursor.id}::uuid)
            )
          )
        order by s.created_at desc, s.id desc
        limit ${input.limit + 1}
      `;

      return keysetPage(
        rows,
        input.limit,
        toSubscription,
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
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
