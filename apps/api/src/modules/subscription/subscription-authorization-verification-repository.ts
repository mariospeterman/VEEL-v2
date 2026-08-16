import type postgres from "postgres";
import type { SubscriptionPlan, SubscriptionRepository } from "./types.js";
import { SubscriptionRepositoryConfigurationError } from "./subscription-errors.js";
import type { SubscriptionRow } from "./subscription-repository-rows.js";
import {
  findActor,
  findSubscriptionById,
  insertSubscriptionEvent
} from "./subscription-repository-support.js";

export async function findAuthorizationVerificationContext(
  sql: postgres.Sql,
  input: Parameters<SubscriptionRepository["findAuthorizationVerificationContext"]>[0]
) {
  const rows = await sql<
    {
      authorization_intent_id: string;
      setup_reference: string;
      collector_address: string | null;
      subscriber_wallet: string | null;
      authority_address: string | null;
      delegation_address: string | null;
      subscriber_token_account: string | null;
      token_mint: string | null;
      token_program: "spl_token" | "token_2022" | null;
      amount_minor: string | number;
      amount_atomic: string | number;
      period_days: number;
      period_seconds: number;
      delegation_nonce: string | number;
      delegation_expires_at: Date | null;
      provider: string;
      plan_id: string;
      plan_pda: string | null;
      subscription_pda: string | null;
      merchant_wallet: string | null;
      expires_at: Date;
    }[]
  >`
    select
      sai.id as authorization_intent_id,
      sai.setup_reference,
      s.collector_address,
      s.subscriber_wallet,
      sai.authority_address,
      sai.delegation_address,
      sai.subscriber_token_account,
      sp.token_mint,
      sp.token_program,
      sp.amount_minor,
      sp.amount_atomic,
      sp.period_days,
      sp.period_seconds,
      s.delegation_nonce,
      sai.delegation_expires_at,
      coalesce(s.provider, sp.provider, 'official_solana_subscription_program') as provider,
      sp.id as plan_id,
      coalesce(s.plan_pda, sp.plan_pda) as plan_pda,
      s.subscription_pda,
      coalesce(s.merchant_wallet, sp.merchant_wallet) as merchant_wallet,
      sai.expires_at
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
        subscriberWallet: row.subscriber_wallet,
        authorityAddress: row.authority_address,
        delegationAddress: row.delegation_address,
        subscriberTokenAccount: row.subscriber_token_account,
        tokenMint: row.token_mint,
        tokenProgram: row.token_program,
        amountMinor: Number(row.amount_minor),
        amountAtomic: Number(row.amount_atomic),
        periodDays: row.period_days,
        periodSeconds: row.period_seconds,
        delegationNonce: Number(row.delegation_nonce),
        delegationExpiresAt: row.delegation_expires_at,
        provider: row.provider,
        planId: row.plan_id,
        planPda: row.plan_pda,
        subscriptionPda: row.subscription_pda,
        merchantWallet: row.merchant_wallet,
        expiresAt: row.expires_at
      }
    : null;
}

export async function recordAuthorizationTransactionFacts(
  sql: postgres.Sql,
  input: Parameters<SubscriptionRepository["recordAuthorizationTransactionFacts"]>[0]
) {
  const rows = await sql<{ id: string }[]>`
    update subscription_authorization_intents sai
    set
      authority_address = ${input.authorityAddress},
      delegation_address = ${input.delegationAddress},
      subscriber_token_account = ${input.subscriberTokenAccount},
      subscription_authority_pda = ${input.authorityAddress},
      subscription_pda = ${input.delegationAddress},
      delegation_expires_at = ${input.delegationExpiresAt}
    from subscriptions s
    join users u on u.id = s.subscriber_user_id
    where sai.id = ${input.authorizationIntentId}
      and sai.subscription_id = s.id
      and u.supabase_user_id = ${input.supabaseUserId}
      and sai.state in ('created', 'submitted')
      and sai.expires_at > now()
    returning sai.id
  `;

  if (!rows[0]) {
    throw new SubscriptionRepositoryConfigurationError();
  }
}

export async function submitAuthorization(
  sql: postgres.Sql,
  input: Parameters<SubscriptionRepository["submitAuthorization"]>[0]
) {
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
        plan_amount_atomic: string | number;
        plan_creator_amount_atomic: string | number;
        plan_platform_fee_amount_atomic: string | number;
        plan_allocation_amount_atomic: string | number;
        plan_currency: SubscriptionPlan["currency"];
      })[]
    >`
      update subscription_authorization_intents sai
      set
        state = case when ${input.verification.verified} then 'verified' else 'submitted' end,
        submitted_signature = ${input.body.signature},
        verified_signature = case when ${input.verification.verified} then ${input.body.signature} else sai.verified_signature end,
        failure_reason = case when ${input.verification.verified} then null else ${input.verification.failureCode ?? null}::text end,
        submitted_at = coalesce(sai.submitted_at, now()),
        verified_at = case when ${input.verification.verified} then now() else sai.verified_at end
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
        p.avatar_url as creator_avatar_url,
        sai.id as authorization_intent_id,
        sp.period_days as plan_period_days,
        sp.amount_minor as plan_amount_minor,
        sp.amount_atomic as plan_amount_atomic,
        sp.creator_amount_atomic as plan_creator_amount_atomic,
        sp.platform_fee_amount_atomic as plan_platform_fee_amount_atomic,
        sp.allocation_amount_atomic as plan_allocation_amount_atomic,
        sp.currency as plan_currency
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    await activateSubscriptionAfterVerification(transaction, row, input);
    const subscription = await findSubscriptionById(transaction, {
      supabaseUserId: input.supabaseUserId,
      subscriptionId: row.id
    });

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

async function activateSubscriptionAfterVerification(
  transaction: postgres.TransactionSql,
  row: SubscriptionRow & {
    plan_period_days: number;
    plan_amount_minor: string | number;
    plan_amount_atomic: string | number;
    plan_creator_amount_atomic: string | number;
    plan_platform_fee_amount_atomic: string | number;
    plan_allocation_amount_atomic: string | number;
    plan_currency: SubscriptionPlan["currency"];
  },
  input: Parameters<SubscriptionRepository["submitAuthorization"]>[0]
) {
  await transaction`
    update subscriptions s
    set
      authority_address = ${input.verification.facts?.authorityAddress ?? null},
      delegation_address = ${input.verification.facts?.delegationAddress ?? null},
      subscriber_token_account = ${input.verification.facts?.subscriberTokenAccount ?? null},
      user_token_account = ${input.verification.facts?.subscriberTokenAccount ?? null},
      subscription_authority_pda = ${input.verification.facts?.authorityAddress ?? null},
      subscription_pda = coalesce(s.subscription_pda, ${input.verification.facts?.delegationAddress ?? null}::text),
      plan_pda = coalesce(s.plan_pda, ${input.verification.facts?.planPda ?? null}::text),
      setup_signature = ${input.body.signature},
      verified_signature = case when ${input.verification.verified} then ${input.body.signature} else s.verified_signature end,
      verified_at = case when ${input.verification.verified} then now() else s.verified_at end,
      failure_reason = case when ${input.verification.verified} then null else ${input.verification.failureCode ?? null}::text end,
      delegation_expires_at = case when ${input.verification.verified} then ${input.verification.facts?.delegationExpiresAt ?? null}::timestamptz else s.delegation_expires_at end,
      state = case when ${input.verification.verified} then 'renewal_pending' else s.state end,
      current_period_starts_at = case when ${input.verification.verified} then null else s.current_period_starts_at end,
      current_period_ends_at = case when ${input.verification.verified} then null else s.current_period_ends_at end,
      next_collection_at = case when ${input.verification.verified} then now() else s.next_collection_at end,
      updated_at = now()
    where s.id = ${row.id}
  `;
}
