import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function deliverPaidMessage(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const candidates = await transaction<{
    conversation_id: string;
    recipient_user_id: string;
    sender_user_id: string;
  }[]>`
    select conversation_id, recipient_user_id, sender_user_id
    from paid_message_delivery_requests
    where payment_intent_id = ${input.paymentIntentId}
      and sender_user_id = ${input.userId}
      and state = 'pending_payment'
    limit 1
  `;
  const candidate = candidates[0];
  if (!candidate) return;

  // Keep the same lock order as message-request mutations: conversation, members,
  // users, request, then delivery draft. This serializes delivery with declines and blocks.
  await transaction`
    select id from conversations where id = ${candidate.conversation_id} for update
  `;
  await transaction`
    select conversation_id, user_id
    from conversation_members
    where conversation_id = ${candidate.conversation_id}
    order by user_id
    for update
  `;
  await transaction`
    select id from users
    where id in (${candidate.sender_user_id}, ${candidate.recipient_user_id})
    order by id
    for update
  `;
  await transaction`
    select conversation_id
    from direct_message_requests
    where conversation_id = ${candidate.conversation_id}
    for update
  `;
  await transaction`
    select payment_intent_id
    from paid_message_delivery_requests
    where payment_intent_id = ${input.paymentIntentId}
    for update
  `;

  const rows = await transaction<{ message_id: string; conversation_id: string; recipient_user_id: string }[]>`
    with draft as (
      select
        request.conversation_id,
        request.sender_user_id,
        request.recipient_user_id,
        request.body
      from paid_message_delivery_requests request
      join conversations c on c.id = request.conversation_id and c.state = 'active'
      left join direct_message_requests message_request
        on message_request.conversation_id = request.conversation_id
      where request.payment_intent_id = ${input.paymentIntentId}
        and request.sender_user_id = ${input.userId}
        and request.state = 'pending_payment'
        and coalesce(message_request.state, 'accepted') <> 'declined'
        and not exists (
          select 1 from blocks b
          where (b.blocker_user_id = request.sender_user_id and b.blocked_user_id = request.recipient_user_id)
             or (b.blocker_user_id = request.recipient_user_id and b.blocked_user_id = request.sender_user_id)
        )
      limit 1
      for update of request
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
      returning inserted_message.id, inserted_message.conversation_id, pmdr.recipient_user_id
    )
    select
      id as message_id,
      conversation_id,
      recipient_user_id
    from updated_draft
    limit 1
  `;
  const delivered = rows[0];

  if (!delivered) {
    const cancelled = await transaction<{ conversation_id: string }[]>`
      update paid_message_delivery_requests request
      set state = 'cancelled'
      where request.payment_intent_id = ${input.paymentIntentId}
        and request.sender_user_id = ${input.userId}
        and request.state = 'pending_payment'
        and (
          not exists (
            select 1 from conversations c
            where c.id = request.conversation_id and c.state = 'active'
          )
          or exists (
            select 1 from blocks b
            where (b.blocker_user_id = request.sender_user_id and b.blocked_user_id = request.recipient_user_id)
               or (b.blocker_user_id = request.recipient_user_id and b.blocked_user_id = request.sender_user_id)
          )
          or exists (
            select 1 from direct_message_requests message_request
            where message_request.conversation_id = request.conversation_id
              and message_request.state = 'declined'
          )
      )
      returning request.conversation_id
    `;
    if (!cancelled[0]) return;

    await transaction`
      insert into audit_events (
        id, actor_user_id, subject_type, subject_id, action, metadata
      ) values (
        ${randomUUID()}, ${input.userId}, 'payment_intent', ${input.paymentIntentId},
        'paid_message_delivery_ineligible_after_settlement',
        ${transaction.json({ conversationId: cancelled[0].conversation_id })}
      )
    `;
    await transaction`
      insert into notifications (
        id, user_id, kind, title, body, action_url,
        related_resource_type, related_resource_id, idempotency_key
      ) values (
        ${randomUUID()}, ${input.userId}, 'payment', 'Paid message needs support review',
        'Settlement was confirmed, but the conversation safety state prevented delivery. Contact support for review.',
        '/app/wallet', 'payment', ${input.paymentIntentId},
        'paid-message-remediation:' || ${input.paymentIntentId}
      ) on conflict (user_id, idempotency_key) do nothing
    `;
    return;
  }

  await transaction`
    insert into notifications (
      id, user_id, kind, title, body, action_url,
      related_resource_type, related_resource_id, idempotency_key
    ) values (
      ${randomUUID()}, ${delivered.recipient_user_id}, 'message', 'New paid message',
      'A paid message is ready in your inbox.',
      '/app/messages?conversation=' || ${delivered.conversation_id},
      'message', ${delivered.message_id}, 'paid-message:' || ${delivered.message_id}
    ) on conflict (user_id, idempotency_key) do nothing
  `;

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
