import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { isRecipientMonetisationPolicyError } from "../payment/payment-repository-errors.js";
import type { SubscriptionRepository } from "./types.js";
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

export async function createAuthorizationIntent(
  sql: postgres.Sql,
  input: Parameters<SubscriptionRepository["createAuthorizationIntent"]>[0]
) {
  const actor = await findActor(sql, input.supabaseUserId);

  if (!actor) {
    throw new SubscriptionRepositoryConfigurationError();
  }

  const existing = await sql<
    (AuthorizationIntentRow & { plan_id: string; creator_user_id: string | null })[]
  >`
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
      sp.description,
      sp.benefits,
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
    where sp.id = ${input.body.planId}
      and sp.state = 'active'
      and sp.provider_state <> 'disabled'
    limit 1
  `;
  const plan = planRows[0];

  if (!plan) {
    throw new SubscriptionPolicyError("subscription_plan_not_found");
  }

  assertPlanPolicy(plan, input.body.creatorUserId, actor.id, input.supportedMints, input.provider);

  const walletRows = await sql<{ address: string }[]>`
    select w.address
    from wallets w
    where w.user_id = ${actor.id}
      and w.chain in ('solana_devnet', 'solana_mainnet')
    order by w.is_primary desc, w.created_at asc
    limit 1
  `;
  const subscriberWallet = walletRows[0]?.address;

  if (!subscriberWallet) {
    throw new SubscriptionPolicyError("subscriber_wallet_required");
  }

  const subscriptionId = randomUUID();
  const intentId = randomUUID();
  const setupReference = randomUUID();

  const result = await sql.begin(async (transaction) => {
    if (plan.creator_user_id) {
      let recipientWalletRows: { address: string }[];
      try {
        recipientWalletRows = await transaction<{ address: string }[]>`
          select address
          from private.assert_recipient_monetisation_ready(
            ${plan.creator_user_id},
            'creator_subscription',
            null,
            null
          )
        `;
      } catch (error) {
        if (isRecipientMonetisationPolicyError(error)) {
          throw new SubscriptionPolicyError(error.message);
        }
        throw error;
      }

      if (recipientWalletRows[0]?.address !== plan.merchant_wallet) {
        throw new SubscriptionPolicyError("recipient_wallet_mismatch");
      }
    }

    const subscriptionRows = await transaction<SubscriptionRow[]>`
      insert into subscriptions (
        id,
        subscriber_user_id,
        scope,
        plan_id,
        creator_user_id,
        state,
        renewal_mode,
        collector_address,
        subscriber_wallet,
        provider,
        program_id,
        token_mint,
        amount_atomic,
        period_seconds,
        plan_pda,
        merchant_wallet
      )
      values (
        ${subscriptionId},
        ${actor.id},
        ${plan.scope},
        ${plan.id},
        ${plan.creator_user_id},
        'authorization_pending',
        'delegated_solana_subscription',
        ${input.collectorAddress},
        ${subscriberWallet},
        ${input.provider},
        ${input.delegationProgramId},
        ${plan.token_mint},
        ${Number(plan.amount_atomic ?? plan.amount_minor)},
        ${plan.period_seconds ?? plan.period_days * 86_400},
        ${plan.plan_pda},
        ${plan.merchant_wallet}
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
        subscriber_wallet,
        provider,
        program_id,
        token_mint,
        amount_atomic,
        period_seconds,
        plan_pda,
        subscription_pda,
        merchant_wallet,
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
}

function assertPlanPolicy(
  plan: PlanRow,
  requestedCreatorUserId: string | undefined,
  actorUserId: string,
  supportedMints: string[],
  provider: string
) {
  if (plan.billing_mode !== "delegated_solana_subscription") {
    throw new SubscriptionPolicyError("subscription_plan_requires_delegated_billing");
  }

  if (provider !== "official_solana_subscription_program") {
    throw new SubscriptionPolicyError("subscription_provider_not_configured");
  }

  if (plan.currency === "SOL") {
    throw new SubscriptionPolicyError("unsupported_native_sol_subscription");
  }

  if (!plan.token_mint || !supportedMints.includes(plan.token_mint)) {
    throw new SubscriptionPolicyError("unsupported_subscription_mint");
  }

  if (plan.provider_state !== "launch_approved") {
    throw new SubscriptionPolicyError("subscription_plan_requires_onchain_verification");
  }

  if (plan.scope === "creator") {
    if (!requestedCreatorUserId || requestedCreatorUserId !== plan.creator_user_id) {
      throw new SubscriptionPolicyError("creator_plan_mismatch");
    }
  } else if (requestedCreatorUserId) {
    throw new SubscriptionPolicyError("platform_plan_cannot_target_creator");
  }

  if (plan.creator_user_id === actorUserId) {
    throw new SubscriptionPolicyError("cannot_subscribe_to_self");
  }
}
