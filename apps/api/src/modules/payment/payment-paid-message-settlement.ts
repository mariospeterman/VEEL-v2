import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function deliverPaidMessage(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const rows = await transaction<{ message_id: string; conversation_id: string }[]>`
    with draft as (
      select
        conversation_id,
        sender_user_id,
        body
      from paid_message_delivery_requests
      where payment_intent_id = ${input.paymentIntentId}
        and sender_user_id = ${input.userId}
        and state = 'pending_payment'
      limit 1
    ),
    inserted_message as (
      insert into messages (
        id,
        conversation_id,
        sender_user_id,
        body,
        delivery_state,
        payment_intent_id
      )
      select
        ${randomUUID()},
        conversation_id,
        sender_user_id,
        body,
        'visible',
        ${input.paymentIntentId}
      from draft
      on conflict (payment_intent_id) do update
      set delivery_state = messages.delivery_state
      returning id, conversation_id
    ),
    updated_draft as (
      update paid_message_delivery_requests pmdr
      set
        state = 'delivered',
        message_id = inserted_message.id,
        delivered_at = now()
      from inserted_message
      where pmdr.payment_intent_id = ${input.paymentIntentId}
      returning inserted_message.id, inserted_message.conversation_id
    )
    select
      id as message_id,
      conversation_id
    from updated_draft
    limit 1
  `;
  const delivered = rows[0];

  if (!delivered) {
    return;
  }

  await transaction`
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.userId},
      'message',
      ${delivered.message_id},
      'paid_message_delivered',
      ${transaction.json({
        conversationId: delivered.conversation_id,
        paymentIntentId: input.paymentIntentId
      })}
    )
  `;
}
