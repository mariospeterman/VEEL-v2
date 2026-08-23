import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function settleCreatorMediaOffer(
  transaction: postgres.TransactionSql,
  input: { userId: string; paymentIntentId: string }
): Promise<{ kind: "not_offer" } | { kind: "purchased"; contentItemId: string } | { kind: "remediation" }> {
  const rows = await transaction<{
    id: string;
    content_item_id: string;
    buyer_user_id: string;
    creator_user_id: string;
    conversation_id: string;
    eligible: boolean;
  }[]>`
    select offer.id, offer.content_item_id, offer.buyer_user_id, offer.creator_user_id,
      offer.conversation_id,
      offer.buyer_user_id = ${input.userId}
      and offer.state in ('accepted', 'purchased')
      and offer.expires_at > now()
      and content.asset_revision = offer.content_revision
      and content.state = 'ready'
      and content.publish_state = 'published'
      and content.moderation_state = 'approved'
      and conversation.state = 'active'
      and coalesce(direct_request.state, 'accepted') = 'accepted'
      and not exists (
        select 1 from blocks block
        where (block.blocker_user_id = offer.buyer_user_id and block.blocked_user_id = offer.creator_user_id)
           or (block.blocker_user_id = offer.creator_user_id and block.blocked_user_id = offer.buyer_user_id)
      ) as eligible
    from payment_intents intent
    join creator_media_offers offer on offer.id = intent.target_id
    join content_items content on content.id = offer.content_item_id
    join conversations conversation on conversation.id = offer.conversation_id
    left join direct_message_requests direct_request on direct_request.conversation_id = offer.conversation_id
    where intent.id = ${input.paymentIntentId}
      and intent.product_type = 'content_unlock'
    limit 1
    for update of offer, conversation, content
  `;
  const offer = rows[0];
  if (!offer) return { kind: "not_offer" };
  if (offer.eligible) {
    await transaction`
      update creator_media_offers
      set state = 'purchased', payment_intent_id = ${input.paymentIntentId},
          purchased_at = coalesce(purchased_at, now()), updated_at = now()
      where id = ${offer.id}
    `;
    return { kind: "purchased", contentItemId: offer.content_item_id };
  }
  await transaction`
    update creator_media_offers
    set state = 'remediation', payment_intent_id = ${input.paymentIntentId}, updated_at = now()
    where id = ${offer.id} and state <> 'purchased'
  `;
  await transaction`
    insert into notifications (
      id, user_id, kind, title, body, action_url,
      related_resource_type, related_resource_id, idempotency_key
    ) values (
      ${randomUUID()}, ${input.userId}, 'payment', 'Media offer needs remediation',
      'Settlement was verified, but consent changed before entitlement activation. Support review is required.',
      '/app/activity', 'creator_media_offer', ${offer.id}, 'media-offer-remediation:' || ${offer.id}
    ) on conflict (user_id, idempotency_key) do nothing
  `;
  await transaction`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (
      ${randomUUID()}, ${input.userId}, 'creator_media_offer', ${offer.id},
      'creator_media_offer.remediation_after_settlement',
      ${transaction.json({ paymentIntentId: input.paymentIntentId, consentEligible: false })}
    )
  `;
  return { kind: "remediation" };
}

export async function settleStructuredCreatorRequest(
  transaction: postgres.TransactionSql,
  input: { userId: string; paymentIntentId: string }
): Promise<boolean> {
  const requests = await transaction<{
    id: string;
    conversation_id: string;
    creator_user_id: string;
    state: string;
    eligible: boolean;
  }[]>`
    select request.id, request.conversation_id, request.creator_user_id, request.state,
      request.requester_user_id = ${input.userId}
      and request.state in ('accepted', 'payment_pending', 'active')
      and conversation.state = 'active'
      and coalesce(direct_request.state, 'accepted') = 'accepted'
      and not exists (
        select 1 from blocks block
        where (block.blocker_user_id = request.requester_user_id and block.blocked_user_id = request.creator_user_id)
           or (block.blocker_user_id = request.creator_user_id and block.blocked_user_id = request.requester_user_id)
      ) as eligible
    from payment_intents intent
    join structured_creator_requests request on request.id = intent.target_id
    join conversations conversation on conversation.id = request.conversation_id
    left join direct_message_requests direct_request on direct_request.conversation_id = request.conversation_id
    where intent.id = ${input.paymentIntentId}
      and intent.product_type = 'paid_message'
      and (request.payment_intent_id is null or request.payment_intent_id = intent.id)
    limit 1
    for update of request, conversation
  `;
  const request = requests[0];
  if (!request) return false;

  if (request.eligible) {
    await transaction`
      update structured_creator_requests
      set state = 'active', payment_intent_id = ${input.paymentIntentId},
          activated_at = coalesce(activated_at, now()), updated_at = now()
      where id = ${request.id} and state in ('accepted', 'payment_pending', 'active')
    `;
    await transaction`
      insert into notifications (
        id, user_id, kind, title, body, action_url,
        related_resource_type, related_resource_id, idempotency_key
      ) values (
        ${randomUUID()}, ${request.creator_user_id}, 'payment', 'Creator request activated',
        'Verified settlement activated the agreed delivery workspace.',
        '/app/messages?conversation=' || ${request.conversation_id},
        'structured_creator_request', ${request.id}, 'creator-request-active:' || ${request.id}
      ) on conflict (user_id, idempotency_key) do nothing
    `;
  } else {
    await transaction`
      update structured_creator_requests
      set state = 'remediation', payment_intent_id = ${input.paymentIntentId}, updated_at = now()
      where id = ${request.id} and state not in ('completed', 'cancelled', 'expired')
    `;
    await transaction`
      insert into notifications (
        id, user_id, kind, title, body, action_url,
        related_resource_type, related_resource_id, idempotency_key
      ) values (
        ${randomUUID()}, ${input.userId}, 'payment', 'Creator request needs remediation',
        'Settlement was verified, but the consent relationship changed before activation. Support review is required.',
        '/app/activity', 'structured_creator_request', ${request.id},
        'creator-request-remediation:' || ${request.id}
      ) on conflict (user_id, idempotency_key) do nothing
    `;
  }

  await transaction`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (
      ${randomUUID()}, ${input.userId}, 'structured_creator_request', ${request.id},
      ${request.eligible ? "creator_request.activated_after_settlement" : "creator_request.remediation_after_settlement"},
      ${transaction.json({ paymentIntentId: input.paymentIntentId, consentEligible: request.eligible })}
    )
  `;
  return true;
}
