import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  type MessageRow,
  messageSelectSql,
  toMessage
} from "./message-repository-mappers.js";
import type { ConversationInput, CreateMessageInput, CreatePaidMessageDraftInput } from "./types.js";

export async function createMessage(sql: postgres.Sql, input: CreateMessageInput) {
  const rows = await sql<MessageRow[]>`
    with actor as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    participant as (
      select cm.conversation_id, actor.id as actor_user_id
      from conversation_members cm
      join actor on actor.id = cm.user_id
      where cm.conversation_id = ${input.conversationId}
      limit 1
    ),
    inserted_message as (
      insert into messages (
        id,
        conversation_id,
        sender_user_id,
        body
      )
      select
        ${randomUUID()},
        conversation_id,
        actor_user_id,
        ${input.body}
      from participant
      returning *
    )
    ${messageSelectSql(sql)}
    join inserted_message im on im.id = m.id
  `;

  return rows[0] ? toMessage(rows[0]) : null;
}

export async function findConversationPrice(sql: postgres.Sql, input: ConversationInput) {
  const rows = await sql<{ recipient_user_id: string }[]>`
    with actor as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select cm.user_id as recipient_user_id
    from conversation_members cm
    where cm.conversation_id = ${input.conversationId}
      and cm.user_id <> (select id from actor)
    limit 1
  `;
  const row = rows[0];

  return row
    ? {
        conversationId: input.conversationId,
        amountMinor: 10_000_000,
        currency: "SOL" as const,
        recipientUserId: row.recipient_user_id
      }
    : null;
}

export async function recordPaidMessageDraft(
  sql: postgres.Sql,
  input: CreatePaidMessageDraftInput
) {
  await sql`
    with actor as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    recipient as (
      select cm.user_id
      from conversation_members cm
      where cm.conversation_id = ${input.conversationId}
        and cm.user_id <> (select id from actor)
      limit 1
    )
    insert into paid_message_delivery_requests (
      payment_intent_id,
      conversation_id,
      sender_user_id,
      recipient_user_id,
      body,
      amount_minor,
      currency
    )
    select
      ${input.paymentIntentId},
      ${input.conversationId},
      actor.id,
      recipient.user_id,
      ${input.body},
      ${input.amountMinor},
      ${input.currency}
    from actor, recipient
    on conflict (payment_intent_id) do nothing
  `;
}
