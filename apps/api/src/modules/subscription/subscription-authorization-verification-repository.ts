import { randomUUID } from "node:crypto";
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
    plan_currency: SubscriptionPlan["currency"];
  },
  input: Parameters<SubscriptionRepository["submitAuthorization"]>[0]
) {
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
}
