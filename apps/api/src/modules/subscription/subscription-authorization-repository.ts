import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { SubscriptionPlan, SubscriptionRepository } from "./types.js";
import {
  SubscriptionIdempotencyConflictError,
  SubscriptionPolicyError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-errors.js";
import {
  creatorFieldsFromPlan,
  providerReadinessFromPlanState,
  toAuthorizationIntentResponse,
  toSubscription
} from "./subscription-repository-mappers.js";
import type {
  AuthorizationIntentRow,
  PlanRow,
  SubscriptionRow
} from "./subscription-repository-rows.js";
import {
  findActor,
  findSubscriptionById,
  insertSubscriptionEvent
} from "./subscription-repository-support.js";

export function createSubscriptionAuthorizationRepositoryMethods(
  sql: postgres.Sql
): Pick<
  SubscriptionRepository,
  "createAuthorizationIntent" | "findAuthorizationVerificationContext" | "submitAuthorization"
> {
  return {
    async createAuthorizationIntent(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      const existing = await sql<(AuthorizationIntentRow & { plan_id: string; creator_user_id: string | null })[]>`
        select
          sai.id,
          sai.subscription_id,
          sai.setup_reference,
          sai.transaction_request_url,
          sai.expires_at,
          sai.request_hash,
          sai.state,
          s.plan_id,
          s.creator_user_id
        from subscription_authorization_intents sai
        join subscriptions s on s.id = sai.subscription_id
        where s.subscriber_user_id = ${actor.id}
          and sai.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const existingIntent = existing[0];

      if (existingIntent) {
        if (existingIntent.request_hash !== input.requestHash) {
          throw new SubscriptionIdempotencyConflictError();
        }

        const subscription = await findSubscriptionById(sql, {
          supabaseUserId: input.supabaseUserId,
          subscriptionId: existingIntent.subscription_id
        });

        if (!subscription) {
          throw new SubscriptionRepositoryConfigurationError();
        }

        return toAuthorizationIntentResponse({
          intent: existingIntent,
          subscription,
          providerState: providerReadinessFromPlanState("staging_required")
        });
      }

      const planRows = await sql<PlanRow[]>`
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
        where sp.id = ${input.body.planId}
          and sp.state = 'active'
          and sp.provider_state <> 'disabled'
        limit 1
      `;
      const plan = planRows[0];

      if (!plan) {
        throw new SubscriptionPolicyError("subscription_plan_not_found");
      }

      if (plan.billing_mode !== "delegated_solana_subscription") {
        throw new SubscriptionPolicyError("subscription_plan_requires_delegated_billing");
      }

      if (plan.scope === "creator") {
        if (!input.body.creatorUserId || input.body.creatorUserId !== plan.creator_user_id) {
          throw new SubscriptionPolicyError("creator_plan_mismatch");
        }
      } else if (input.body.creatorUserId) {
        throw new SubscriptionPolicyError("platform_plan_cannot_target_creator");
      }

      if (plan.creator_user_id === actor.id) {
        throw new SubscriptionPolicyError("cannot_subscribe_to_self");
      }

      const subscriptionId = randomUUID();
      const intentId = randomUUID();
      const setupReference = randomUUID();

      const result = await sql.begin(async (transaction) => {
        const subscriptionRows = await transaction<SubscriptionRow[]>`
          insert into subscriptions (
            id,
            subscriber_user_id,
            scope,
            plan_id,
            creator_user_id,
            state,
            renewal_mode,
            collector_address
          )
          values (
            ${subscriptionId},
            ${actor.id},
            ${plan.scope},
            ${plan.id},
            ${plan.creator_user_id},
            'authorization_pending',
            'delegated_solana_subscription',
            ${input.collectorAddress}
          )
          on conflict do nothing
          returning
            id,
            scope,
            plan_id,
            state,
            renewal_mode,
            current_period_ends_at,
            next_collection_at,
            cancelled_at,
            revoked_at,
            authority_address,
            delegation_address,
            creator_user_id,
            null::text as creator_handle,
            null::text as creator_display_name,
            null::text as creator_avatar_url
        `;
        const subscription = subscriptionRows[0];

        if (!subscription) {
          throw new SubscriptionPolicyError("subscription_already_open");
        }

        const intentRows = await transaction<AuthorizationIntentRow[]>`
          insert into subscription_authorization_intents (
            id,
            subscription_id,
            idempotency_key,
            request_hash,
            setup_reference,
            transaction_request_url,
            expires_at
          )
          values (
            ${intentId},
            ${subscriptionId},
            ${input.idempotencyKey},
            ${input.requestHash},
            ${setupReference},
            null,
            ${input.expiresAt}
          )
          returning
            id,
            subscription_id,
            setup_reference,
            transaction_request_url,
            expires_at,
            request_hash,
            state
        `;
        const intent = intentRows[0];

        if (!intent) {
          throw new SubscriptionRepositoryConfigurationError();
        }

        await insertSubscriptionEvent(transaction, {
          subscriptionId,
          actorUserId: actor.id,
          action: "subscription.authorization_intent_created",
          authorizationIntentId: intent.id,
          metadata: {
            planId: plan.id,
            delegationProgramId: input.delegationProgramId,
            providerState: plan.provider_state
          }
        });

        return {
          intent,
          subscription: toSubscription({ ...subscription, ...creatorFieldsFromPlan(plan) }),
          providerState: providerReadinessFromPlanState(plan.provider_state)
        };
      });

      return toAuthorizationIntentResponse(result);
    },

    async findAuthorizationVerificationContext(input) {
      const rows = await sql<
        {
          authorization_intent_id: string;
          setup_reference: string;
          collector_address: string | null;
          token_mint: string | null;
          token_program: "spl_token" | "token_2022" | null;
          amount_minor: string | number;
          period_days: number;
        }[]
      >`
        select
          sai.id as authorization_intent_id,
          sai.setup_reference,
          s.collector_address,
          sp.token_mint,
          sp.token_program,
          sp.amount_minor,
          sp.period_days
        from subscription_authorization_intents sai
        join subscriptions s on s.id = sai.subscription_id
        join subscription_plans sp on sp.id = s.plan_id
        join users u on u.id = s.subscriber_user_id
        where sai.id = ${input.authorizationIntentId}
          and u.supabase_user_id = ${input.supabaseUserId}
          and sai.state in ('created', 'submitted')
        limit 1
      `;
      const row = rows[0];

      return row
        ? {
            authorizationIntentId: row.authorization_intent_id,
            setupReference: row.setup_reference,
            delegationProgramId: input.delegationProgramId,
            collectorAddress: row.collector_address,
            tokenMint: row.token_mint,
            tokenProgram: row.token_program,
            amountMinor: Number(row.amount_minor),
            periodDays: row.period_days
          }
        : null;
    },

    async submitAuthorization(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      return sql.begin(async (transaction) => {
        const rows = await transaction<
          (SubscriptionRow & {
            authorization_intent_id: string;
            plan_period_days: number;
            plan_amount_minor: string | number;
            plan_currency: SubscriptionPlan["currency"];
          })[]
        >`
          update subscription_authorization_intents sai
          set
            state = case when ${input.verification.verified} then 'verified' else 'submitted' end,
            submitted_signature = ${input.body.signature},
            verified_signature = case when ${input.verification.verified} then ${input.body.signature} else verified_signature end,
            submitted_at = coalesce(submitted_at, now()),
            verified_at = case when ${input.verification.verified} then now() else verified_at end
          from subscriptions s
          join subscription_plans sp on sp.id = s.plan_id
          left join profiles p on p.user_id = s.creator_user_id
          where sai.id = ${input.authorizationIntentId}
            and sai.subscription_id = s.id
            and s.subscriber_user_id = ${actor.id}
            and sai.state in ('created', 'submitted')
          returning
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
            p.avatar_url as creator_avatar_url,
            sai.id as authorization_intent_id,
            sp.period_days as plan_period_days,
            sp.amount_minor as plan_amount_minor,
            sp.currency as plan_currency
        `;
        const row = rows[0];

        if (!row) {
          return null;
        }

        await transaction`
          update subscriptions s
          set
            state = case when ${input.verification.verified} then 'active' else state end,
            authority_address = ${input.body.authorityAddress},
            delegation_address = ${input.body.delegationAddress},
            subscriber_token_account = ${input.body.subscriberTokenAccount},
            current_period_starts_at = case when ${input.verification.verified} then coalesce(current_period_starts_at, now()) else current_period_starts_at end,
            current_period_ends_at = case when ${input.verification.verified} then coalesce(current_period_ends_at, now() + (${row.plan_period_days} || ' days')::interval) else current_period_ends_at end,
            next_collection_at = case when ${input.verification.verified} then coalesce(next_collection_at, now() + (${row.plan_period_days} || ' days')::interval) else next_collection_at end,
            updated_at = now()
          where s.id = ${row.id}
        `;
        const subscription = await findSubscriptionById(sql, {
          supabaseUserId: input.supabaseUserId,
          subscriptionId: row.id
        });

        if (input.verification.verified) {
          await transaction`
            insert into subscription_collections (
              id,
              subscription_id,
              period_starts_at,
              period_ends_at,
              amount_minor,
              currency,
              state,
              due_at
            )
            values (
              ${randomUUID()},
              ${row.id},
              now(),
              now() + (${row.plan_period_days} || ' days')::interval,
              ${Number(row.plan_amount_minor)},
              ${row.plan_currency},
              'confirmed',
              now()
            )
            on conflict (subscription_id, period_starts_at) do nothing
          `;
        }

        await insertSubscriptionEvent(transaction, {
          subscriptionId: row.id,
          actorUserId: actor.id,
          action: input.verification.verified
            ? "subscription.authorization_verified"
            : "subscription.authorization_submitted",
          authorizationIntentId: row.authorization_intent_id,
          metadata: {
            failureCode: input.verification.failureCode ?? null
          }
        });

        return subscription;
      });
    }
  };
}
