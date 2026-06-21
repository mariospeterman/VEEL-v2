import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { Subscription } from "./types.js";
import { toSubscription } from "./subscription-repository-mappers.js";
import type { SubscriptionRow } from "./subscription-repository-rows.js";

export async function findActor(
  sql: postgres.Sql,
  supabaseUserId: string
): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`
    select id
    from users
    where supabase_user_id = ${supabaseUserId}
    limit 1
  `;

  return rows[0] ?? null;
}

export async function findSubscriptionById(
  sql: postgres.Sql | postgres.TransactionSql,
  input: {
    supabaseUserId: string;
    subscriptionId: string;
  }
): Promise<Subscription | null> {
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
    where s.id = ${input.subscriptionId}
      and u.supabase_user_id = ${input.supabaseUserId}
    limit 1
  `;

  return rows[0] ? toSubscription(rows[0]) : null;
}

export async function insertSubscriptionEvent(
  transaction: postgres.TransactionSql,
  input: {
    subscriptionId: string;
    actorUserId: string;
    action: string;
    authorizationIntentId: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into subscription_events (
      id,
      subscription_id,
      actor_user_id,
      action,
      authorization_intent_id,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.subscriptionId},
      ${input.actorUserId},
      ${input.action},
      ${input.authorizationIntentId},
      ${transaction.json(input.metadata as postgres.JSONValue)}
    )
  `;
}
