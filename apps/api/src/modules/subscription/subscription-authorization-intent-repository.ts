import { createHash, randomUUID } from "node:crypto";
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

const delegationLifetimeMs = 366 * 24 * 60 * 60 * 1000;
type AuthorizationIntentResponse = Awaited<
  ReturnType<SubscriptionRepository["createAuthorizationIntent"]>
>;

export async function createAuthorizationIntent(
  sql: postgres.Sql,
  input: Parameters<SubscriptionRepository["createAuthorizationIntent"]>[0]
) {
  const actor = await findActor(sql, input.supabaseUserId);

  if (!actor) {
    throw new SubscriptionRepositoryConfigurationError();
  }

  const existingReceiptRows = await sql<Array<{
    request_hash: string;
    response_body: AuthorizationIntentResponse;
  }>>`
    select request_hash, response_body
    from subscription_action_receipts
    where actor_user_id = ${actor.id}
      and action = 'authorization_intent_create'
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `;
  const existingReceipt = existingReceiptRows[0];
  if (existingReceipt) {
    if (existingReceipt.request_hash !== input.requestHash) {
      throw new SubscriptionIdempotencyConflictError();
    }
    return existingReceipt.response_body;
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

  if (!input.collectorAddress) {
    throw new SubscriptionPolicyError("collector_wallet_missing");
  }

  const subscriptionId = randomUUID();
  const intentId = randomUUID();
  const setupReference = randomUUID();
  const delegationExpiresAt = new Date(input.expiresAt.getTime() + delegationLifetimeMs);

  const result = await sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`subscription:authorization_intent_create:${actor.id}:${input.idempotencyKey}`},
          0
        )
      )
    `;
    const receiptRows = await transaction<Array<{
      request_hash: string;
      response_body: AuthorizationIntentResponse;
    }>>`
      select request_hash, response_body
      from subscription_action_receipts
      where actor_user_id = ${actor.id}
        and action = 'authorization_intent_create'
        and idempotency_key = ${input.idempotencyKey}
      limit 1
    `;
    const receipt = receiptRows[0];
    if (receipt) {
      if (receipt.request_hash !== input.requestHash) {
        throw new SubscriptionIdempotencyConflictError();
      }
      return receipt.response_body;
    }

    // The outer lookup is the fast replay path. Repeat it only after taking the
    // transaction-scoped actor/key lock so two concurrent first deliveries
    // cannot both create subscriptions before either durable receipt exists.
    const lockedExistingRows = await transaction<
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
    const lockedExisting = lockedExistingRows[0];
    if (lockedExisting) {
      if (lockedExisting.request_hash !== input.requestHash) {
        throw new SubscriptionIdempotencyConflictError();
      }
      const lockedSubscription = await findSubscriptionById(transaction, {
        supabaseUserId: input.supabaseUserId,
        subscriptionId: lockedExisting.subscription_id
      });
      if (!lockedSubscription) {
        throw new SubscriptionRepositoryConfigurationError();
      }
      const response = toAuthorizationIntentResponse({
        intent: lockedExisting,
        subscription: lockedSubscription,
        providerState: providerReadinessFromPlanState("staging_required")
      });
      await transaction`
        insert into subscription_action_receipts (
          id, actor_user_id, subscription_id, action, idempotency_key, request_hash, response_body
        ) values (
          ${randomUUID()}, ${actor.id}, ${lockedExisting.subscription_id},
          'authorization_intent_create', ${input.idempotencyKey}, ${input.requestHash},
          ${transaction.json(response as postgres.JSONValue)}
        )
        on conflict (actor_user_id, action, idempotency_key) do nothing
      `;
      return response;
    }

    // Lock and re-read the mutable plan in the acceptance transaction. A
    // concurrent disable either commits first and makes this lookup fail, or
    // waits until this acceptance commits; no join can commit after a disable
    // using terms read before that disable.
    const planRows = await transaction<PlanRow[]>`
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
      where sp.id = ${input.body.planId}
        and sp.state = 'active'
        and sp.provider_state <> 'disabled'
      limit 1
      for share of sp
    `;
    const plan = planRows[0];
    if (!plan) {
      throw new SubscriptionPolicyError("subscription_plan_not_found");
    }
    assertPlanPolicy(
      plan,
      input.body.creatorUserId,
      actor.id,
      input.supportedMints,
      input.provider,
      input.delegationProgramId,
      input.assetDecimals
    );
    const tokenProgram = plan.token_program;
    if (!tokenProgram) {
      throw new SubscriptionPolicyError("subscription_plan_terms_mismatch");
    }

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

    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`${subscriberWallet}:${plan.token_mint}:${input.collectorAddress}`},
          0
        )
      )
    `;
    const nonceRows = await transaction<{ delegation_nonce: string | number }[]>`
      select coalesce(max(delegation_nonce), 0) + 1 as delegation_nonce
      from subscriptions
      where subscriber_wallet = ${subscriberWallet}
        and token_mint = ${plan.token_mint}
        and collector_address = ${input.collectorAddress}
    `;
    const delegationNonce = Number(nonceRows[0]?.delegation_nonce);
    if (!Number.isSafeInteger(delegationNonce) || delegationNonce <= 0) {
      throw new SubscriptionRepositoryConfigurationError();
    }
    const snapshotHash = createHash("sha256").update(JSON.stringify({
      subscriptionId,
      intentId,
      actorUserId: actor.id,
      planId: plan.id,
      scope: plan.scope,
      creatorUserId: plan.creator_user_id,
      termsVersion: input.body.termsVersion,
      withdrawalWaiverVersion: input.body.withdrawalWaiverVersion,
      immediateAccessAcknowledged: input.body.immediateAccessAcknowledged,
      consentRequestHash: input.requestHash,
      amountMinor: String(plan.amount_minor),
      amountAtomic: String(plan.amount_atomic),
      assetDecimals: plan.asset_decimals,
      currency: plan.currency,
      solanaNetwork: input.network,
      tokenMint: plan.token_mint,
      tokenProgram,
      provider: input.provider,
      programId: input.delegationProgramId,
      periodDays: plan.period_days,
      periodSeconds: plan.period_seconds,
      creatorAmountAtomic: String(plan.creator_amount_atomic),
      platformAmountAtomic: String(plan.platform_fee_amount_atomic),
      allocationAmountAtomic: String(plan.allocation_amount_atomic),
      creatorReceiverWallet: plan.scope === "creator" ? plan.merchant_wallet : null,
      platformReceiverWallet: input.platformReceiverWallet,
      collectorAddress: input.collectorAddress,
      merchantWallet: plan.merchant_wallet,
      delegationNonce
    })).digest("hex");

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
        delegation_nonce,
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
        ${Number(plan.amount_atomic)},
        ${plan.period_seconds},
        ${delegationNonce},
        ${plan.plan_pda},
        ${plan.merchant_wallet}
      )
      on conflict do nothing
      returning
        id,
        created_at,
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
        failure_reason,
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
        delegation_nonce,
        delegation_expires_at,
        expires_at
      )
      values (
        ${intentId},
        ${subscriptionId},
        ${input.idempotencyKey},
        ${input.requestHash},
        ${setupReference},
        null,
        ${delegationNonce},
        ${delegationExpiresAt},
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

    await transaction`
      insert into subscription_billing_acceptances (
        subscription_id,
        authorization_intent_id,
        accepted_by_user_id,
        plan_id,
        scope,
        creator_user_id,
        terms_version,
        withdrawal_waiver_version,
        immediate_access_acknowledged,
        consent_request_hash,
        amount_minor,
        amount_atomic,
        asset_decimals,
        currency,
        solana_network,
        token_mint,
        token_program,
        provider,
        program_id,
        plan_pda,
        period_days,
        period_seconds,
        creator_amount_atomic,
        platform_amount_atomic,
        allocation_amount_atomic,
        creator_receiver_wallet,
        platform_receiver_wallet,
        allocation_receiver_wallet,
        collector_address,
        merchant_wallet,
        delegation_nonce,
        immutable_hash
      ) values (
        ${subscriptionId},
        ${intent.id},
        ${actor.id},
        ${plan.id},
        ${plan.scope},
        ${plan.creator_user_id},
        ${input.body.termsVersion},
        ${input.body.withdrawalWaiverVersion},
        ${input.body.immediateAccessAcknowledged},
        ${input.requestHash},
        ${plan.amount_minor},
        ${plan.amount_atomic},
        ${plan.asset_decimals},
        ${plan.currency},
        ${input.network},
        ${plan.token_mint},
        ${tokenProgram},
        ${input.provider},
        ${input.delegationProgramId},
        ${plan.plan_pda},
        ${plan.period_days},
        ${plan.period_seconds},
        ${plan.creator_amount_atomic},
        ${plan.platform_fee_amount_atomic},
        ${plan.allocation_amount_atomic},
        ${plan.scope === "creator" ? plan.merchant_wallet : null},
        ${input.platformReceiverWallet},
        null,
        ${input.collectorAddress},
        ${plan.merchant_wallet},
        ${delegationNonce},
        ${snapshotHash}
      )
    `;

    await insertSubscriptionEvent(transaction, {
      subscriptionId,
      actorUserId: actor.id,
      action: "subscription.authorization_intent_created",
      authorizationIntentId: intent.id,
      metadata: {
        planId: plan.id,
        termsVersion: input.body.termsVersion,
        withdrawalWaiverVersion: input.body.withdrawalWaiverVersion,
        delegationProgramId: input.delegationProgramId,
        providerState: plan.provider_state
      }
    });

    const response = toAuthorizationIntentResponse({
      intent,
      subscription: toSubscription({ ...subscription, ...creatorFieldsFromPlan(plan) }),
      providerState: providerReadinessFromPlanState(plan.provider_state)
    });
    await transaction`
      insert into subscription_action_receipts (
        id, actor_user_id, subscription_id, action, idempotency_key, request_hash, response_body
      ) values (
        ${randomUUID()}, ${actor.id}, ${subscriptionId}, 'authorization_intent_create',
        ${input.idempotencyKey}, ${input.requestHash},
        ${transaction.json(response as postgres.JSONValue)}
      )
    `;
    return response;
  });

  return result;
}

function assertPlanPolicy(
  plan: PlanRow,
  requestedCreatorUserId: string | undefined,
  actorUserId: string,
  supportedMints: string[],
  provider: string,
  delegationProgramId: string,
  assetDecimals: number
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

  if (
    !plan.token_program ||
    plan.program_id !== delegationProgramId ||
    plan.provider !== provider ||
    plan.amount_atomic === null ||
    plan.period_seconds === null ||
    plan.asset_decimals !== assetDecimals ||
    plan.creator_amount_atomic === undefined ||
    plan.platform_fee_amount_atomic === undefined ||
    plan.allocation_amount_atomic === undefined ||
    BigInt(plan.creator_amount_atomic) +
      BigInt(plan.platform_fee_amount_atomic) +
      BigInt(plan.allocation_amount_atomic) !== BigInt(plan.amount_atomic)
  ) {
    throw new SubscriptionPolicyError("subscription_plan_terms_mismatch");
  }

  const amountScale = assetDecimals >= 2 ? 10n ** BigInt(assetDecimals - 2) : null;
  if (
    amountScale === null ||
    BigInt(plan.amount_atomic) !== BigInt(plan.amount_minor) * amountScale ||
    plan.period_seconds !== plan.period_days * 86400
  ) {
    throw new SubscriptionPolicyError("subscription_plan_terms_mismatch");
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
