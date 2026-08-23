import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  MessageBlockedError,
  MessageIdempotencyConflictError,
  MessageRequestForbiddenError
} from "./message-errors.js";
import type {
  BindCommercialPaymentIntentInput,
  CommercialPaymentAuthority,
  ConversationCommercialInteractions,
  ConversationInput,
  CreateCreatorMediaOfferInput,
  CreateStructuredCreatorRequestInput,
  CreatorMediaOffer,
  StructuredCreatorRequest,
  UpdateCreatorMediaOfferInput,
  UpdateStructuredCreatorRequestInput
} from "./types.js";

interface CommercialContext {
  actor_id: string;
  other_user_id: string;
}

interface MediaOfferRow {
  id: string;
  conversation_id: string;
  creator_user_id: string;
  buyer_user_id: string;
  content_item_id: string;
  content_revision: number;
  title: string;
  description: string | null;
  amount_minor: number;
  currency: "SOL" | "USDC";
  state: CreatorMediaOffer["state"];
  payment_intent_id: string | null;
  expires_at: Date;
  purchased_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CreatorRequestRow {
  id: string;
  conversation_id: string;
  requester_user_id: string;
  creator_user_id: string;
  deliverable: string;
  permitted_category: StructuredCreatorRequest["permittedCategory"];
  proposed_amount_minor: number | null;
  agreed_amount_minor: number | null;
  currency: "SOL" | "USDC";
  expected_delivery_days: number | null;
  clarification_rule: string;
  cancellation_rule: string;
  state: StructuredCreatorRequest["state"];
  payment_intent_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  activated_at: Date | null;
  delivered_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function listCommercialInteractions(
  sql: postgres.Sql,
  input: ConversationInput
): Promise<ConversationCommercialInteractions | null> {
  const context = await readCommercialContext(sql, input, true);
  if (!context) return null;
  const [offerRows, requestRows] = await Promise.all([
    sql<MediaOfferRow[]>`
      select * from creator_media_offers
      where conversation_id = ${input.conversationId}
      order by created_at desc
      limit 50
    `,
    sql<CreatorRequestRow[]>`
      select * from structured_creator_requests
      where conversation_id = ${input.conversationId}
      order by created_at desc
      limit 50
    `
  ]);
  return {
    mediaOffers: offerRows.map(toMediaOffer),
    creatorRequests: requestRows.map(toCreatorRequest)
  };
}

export async function createCreatorMediaOffer(
  sql: postgres.Sql,
  input: CreateCreatorMediaOfferInput
): Promise<CreatorMediaOffer | null> {
  return sql.begin(async (transaction) => {
    const context = await readCommercialContext(transaction, input, true);
    if (!context) return null;
    const replay = await readReceipt<CreatorMediaOffer>(transaction, context.actor_id, input.idempotencyKey);
    if (replay) return assertReplay(replay, "media_offer.create", input.requestHash);
    const rows = await transaction<MediaOfferRow[]>`
      insert into creator_media_offers (
        conversation_id, creator_user_id, buyer_user_id, content_item_id, content_revision, title,
        description, amount_minor, currency, idempotency_key, request_hash, expires_at
      )
      select
        ${input.conversationId}, ${context.actor_id}, ${context.other_user_id}, content.id, content.asset_revision,
        ${input.body.title.trim()}, ${input.body.description?.trim() ?? null},
        ${input.body.amountMinor}, ${input.body.currency}, ${input.idempotencyKey},
        ${input.requestHash}, ${input.body.expiresAt}
      from content_items content
      where content.id = ${input.body.contentItemId}
        and content.creator_user_id = ${context.actor_id}
        and content.state = 'ready'
        and content.publish_state = 'published'
        and content.moderation_state = 'approved'
        and ${input.body.expiresAt}::timestamptz > now()
      returning *
    `;
    if (!rows[0]) throw new MessageRequestForbiddenError();
    const response = toMediaOffer(rows[0]);
    await writeReceipt(transaction, context.actor_id, input.idempotencyKey, "media_offer.create", input.requestHash, input.conversationId, response);
    await audit(transaction, context.actor_id, "creator_media_offer", response.id, "creator_media_offer.created", input.idempotencyKey, { conversationId: input.conversationId });
    return response;
  });
}

export async function updateCreatorMediaOffer(
  sql: postgres.Sql,
  input: UpdateCreatorMediaOfferInput
): Promise<CreatorMediaOffer | null> {
  return sql.begin(async (transaction) => {
    const context = await readCommercialContext(transaction, input, true);
    if (!context) return null;
    const replay = await readReceipt<CreatorMediaOffer>(transaction, context.actor_id, input.idempotencyKey);
    if (replay) return assertReplay(replay, "media_offer.update", input.requestHash);
    const nextState = input.action === "decline" ? "declined" : "withdrawn";
    const rows = await transaction<MediaOfferRow[]>`
      update creator_media_offers
      set state = ${nextState}, updated_at = now()
      where id = ${input.offerId}
        and conversation_id = ${input.conversationId}
        and state = 'offered'
        and payment_intent_id is null
        and expires_at > now()
        and (
          (${input.action} = 'decline' and buyer_user_id = ${context.actor_id})
          or (${input.action} = 'withdraw' and creator_user_id = ${context.actor_id})
        )
      returning *
    `;
    if (!rows[0]) throw new MessageRequestForbiddenError();
    const response = toMediaOffer(rows[0]);
    await writeReceipt(transaction, context.actor_id, input.idempotencyKey, "media_offer.update", input.requestHash, input.conversationId, response);
    await audit(transaction, context.actor_id, "creator_media_offer", response.id, `creator_media_offer.${nextState}`, input.idempotencyKey, {});
    return response;
  });
}

export async function findCreatorMediaOfferPaymentAuthority(
  sql: postgres.Sql,
  input: ConversationInput & { offerId: string }
): Promise<CommercialPaymentAuthority | null> {
  const context = await readCommercialContext(sql, input, false);
  if (!context) return null;
  const rows = await sql<{
    content_item_id: string;
    creator_user_id: string;
    amount_minor: number;
    currency: "SOL" | "USDC";
    payment_intent_id: string | null;
  }[]>`
    select offer.content_item_id, offer.creator_user_id, offer.amount_minor, offer.currency, offer.payment_intent_id
    from creator_media_offers offer
    join content_items content
      on content.id = offer.content_item_id
      and content.asset_revision = offer.content_revision
      and content.state = 'ready'
      and content.publish_state = 'published'
      and content.moderation_state = 'approved'
    where offer.id = ${input.offerId}
      and offer.conversation_id = ${input.conversationId}
      and offer.buyer_user_id = ${context.actor_id}
      and offer.state in ('offered', 'accepted')
      and offer.expires_at > now()
    limit 1
  `;
  const row = rows[0];
  return row ? {
    targetId: input.offerId,
    paymentIntentId: row.payment_intent_id,
    creatorUserId: row.creator_user_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    productType: "content_unlock"
  } : null;
}

export async function bindCreatorMediaOfferPaymentIntent(
  sql: postgres.Sql,
  input: BindCommercialPaymentIntentInput
): Promise<CreatorMediaOffer | null> {
  const rows = await sql<MediaOfferRow[]>`
    with actor as (select id from users where supabase_user_id = ${input.supabaseUserId})
    update creator_media_offers offer
    set state = 'accepted', payment_intent_id = ${input.paymentIntentId}, updated_at = now()
    where offer.id = ${input.resourceId}
      and offer.conversation_id = ${input.conversationId}
      and offer.buyer_user_id = (select id from actor)
      and offer.state in ('offered', 'accepted')
      and (offer.payment_intent_id is null or offer.payment_intent_id = ${input.paymentIntentId})
      and offer.expires_at > now()
      and exists (
        select 1 from content_items content
        where content.id = offer.content_item_id
          and content.asset_revision = offer.content_revision
          and content.state = 'ready'
          and content.publish_state = 'published'
          and content.moderation_state = 'approved'
      )
      and exists (
        select 1
        from conversations conversation
        left join direct_message_requests request on request.conversation_id = conversation.id
        where conversation.id = offer.conversation_id
          and conversation.state = 'active'
          and coalesce(request.state, 'accepted') = 'accepted'
          and not exists (
            select 1 from blocks block
            where (block.blocker_user_id = offer.buyer_user_id and block.blocked_user_id = offer.creator_user_id)
               or (block.blocker_user_id = offer.creator_user_id and block.blocked_user_id = offer.buyer_user_id)
          )
      )
    returning offer.*
  `;
  return rows[0] ? toMediaOffer(rows[0]) : null;
}

export async function createStructuredCreatorRequest(
  sql: postgres.Sql,
  input: CreateStructuredCreatorRequestInput
): Promise<StructuredCreatorRequest | null> {
  return sql.begin(async (transaction) => {
    const context = await readCommercialContext(transaction, input, true);
    if (!context) return null;
    if (input.body.creatorUserId !== context.other_user_id) throw new MessageRequestForbiddenError();
    const replay = await readReceipt<StructuredCreatorRequest>(transaction, context.actor_id, input.idempotencyKey);
    if (replay) return assertReplay(replay, "creator_request.create", input.requestHash);
    const rows = await transaction<CreatorRequestRow[]>`
      insert into structured_creator_requests (
        conversation_id, requester_user_id, creator_user_id, deliverable, permitted_category,
        proposed_amount_minor, currency, expected_delivery_days, clarification_rule,
        cancellation_rule, idempotency_key, request_hash, expires_at
      ) values (
        ${input.conversationId}, ${context.actor_id}, ${context.other_user_id},
        ${input.body.deliverable.trim()}, ${input.body.permittedCategory},
        ${input.body.proposedAmountMinor ?? null}, ${input.body.currency},
        ${input.body.expectedDeliveryDays ?? null}, ${input.body.clarificationRule.trim()},
        ${input.body.cancellationRule.trim()}, ${input.idempotencyKey}, ${input.requestHash},
        ${input.body.expiresAt}
      )
      returning *
    `;
    const response = toCreatorRequest(rows[0]!);
    await writeReceipt(transaction, context.actor_id, input.idempotencyKey, "creator_request.create", input.requestHash, input.conversationId, response);
    await audit(transaction, context.actor_id, "structured_creator_request", response.id, "creator_request.proposed", input.idempotencyKey, { conversationId: input.conversationId });
    return response;
  });
}

export async function updateStructuredCreatorRequest(
  sql: postgres.Sql,
  input: UpdateStructuredCreatorRequestInput
): Promise<StructuredCreatorRequest | null> {
  return sql.begin(async (transaction) => {
    const context = await readCommercialContext(transaction, input, true);
    if (!context) return null;
    const replay = await readReceipt<StructuredCreatorRequest>(transaction, context.actor_id, input.idempotencyKey);
    if (replay) return assertReplay(replay, "creator_request.update", input.requestHash);
    const existingRows = await transaction<CreatorRequestRow[]>`
      select * from structured_creator_requests
      where id = ${input.requestId} and conversation_id = ${input.conversationId}
      for update
    `;
    const existing = existingRows[0];
    if (!existing) return null;
    if (
      existing.expires_at.getTime() <= Date.now() &&
      ["proposed", "terms_proposed", "accepted", "payment_pending"].includes(existing.state)
    ) {
      throw new MessageRequestForbiddenError();
    }
    const transition = resolveRequestTransition(existing, context.actor_id, input);
    const rows = await transaction<CreatorRequestRow[]>`
      update structured_creator_requests
      set
        state = ${transition.state},
        agreed_amount_minor = ${transition.agreedAmountMinor},
        expected_delivery_days = ${transition.expectedDeliveryDays},
        clarification_rule = ${transition.clarificationRule},
        cancellation_rule = ${transition.cancellationRule},
        accepted_at = case when ${transition.state} = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
        delivered_at = case when ${transition.state} = 'delivered' then now() else delivered_at end,
        completed_at = case when ${transition.state} = 'completed' then now() else completed_at end,
        updated_at = now()
      where id = ${input.requestId}
      returning *
    `;
    const response = toCreatorRequest(rows[0]!);
    await writeReceipt(transaction, context.actor_id, input.idempotencyKey, "creator_request.update", input.requestHash, input.conversationId, response);
    await audit(transaction, context.actor_id, "structured_creator_request", response.id, `creator_request.${input.body.action}`, input.idempotencyKey, { state: response.state });
    return response;
  });
}

export async function findStructuredCreatorRequestPaymentAuthority(
  sql: postgres.Sql,
  input: ConversationInput & { requestId: string }
): Promise<CommercialPaymentAuthority | null> {
  const context = await readCommercialContext(sql, input, true);
  if (!context) return null;
  const rows = await sql<{
    creator_user_id: string;
    agreed_amount_minor: number;
    currency: "SOL" | "USDC";
    payment_intent_id: string | null;
  }[]>`
    select creator_user_id, agreed_amount_minor, currency, payment_intent_id
    from structured_creator_requests
    where id = ${input.requestId}
      and conversation_id = ${input.conversationId}
      and requester_user_id = ${context.actor_id}
      and state in ('accepted', 'payment_pending')
      and expires_at > now()
    limit 1
  `;
  const row = rows[0];
  return row ? {
    targetId: input.requestId,
    paymentIntentId: row.payment_intent_id,
    creatorUserId: row.creator_user_id,
    amountMinor: Number(row.agreed_amount_minor),
    currency: row.currency,
    productType: "paid_message"
  } : null;
}

export async function bindStructuredCreatorRequestPaymentIntent(
  sql: postgres.Sql,
  input: BindCommercialPaymentIntentInput
): Promise<StructuredCreatorRequest | null> {
  const rows = await sql<CreatorRequestRow[]>`
    with actor as (select id from users where supabase_user_id = ${input.supabaseUserId})
    update structured_creator_requests request
    set state = 'payment_pending', payment_intent_id = ${input.paymentIntentId}, updated_at = now()
    where request.id = ${input.resourceId}
      and request.conversation_id = ${input.conversationId}
      and request.requester_user_id = (select id from actor)
      and request.state in ('accepted', 'payment_pending')
      and (request.payment_intent_id is null or request.payment_intent_id = ${input.paymentIntentId})
      and request.expires_at > now()
      and exists (
        select 1
        from conversations conversation
        left join direct_message_requests direct_request on direct_request.conversation_id = conversation.id
        where conversation.id = request.conversation_id
          and conversation.state = 'active'
          and coalesce(direct_request.state, 'accepted') = 'accepted'
          and not exists (
            select 1 from blocks block
            where (block.blocker_user_id = request.requester_user_id and block.blocked_user_id = request.creator_user_id)
               or (block.blocker_user_id = request.creator_user_id and block.blocked_user_id = request.requester_user_id)
          )
      )
    returning request.*
  `;
  return rows[0] ? toCreatorRequest(rows[0]) : null;
}

async function readCommercialContext(
  sql: postgres.ISql,
  input: ConversationInput,
  requireAccepted: boolean
): Promise<CommercialContext | null> {
  const rows = await sql<(CommercialContext & { blocked: boolean; request_state: string | null })[]>`
    select actor.id as actor_id, other_member.user_id as other_user_id,
      request.state as request_state,
      exists (
        select 1 from blocks block
        where (block.blocker_user_id = actor.id and block.blocked_user_id = other_member.user_id)
           or (block.blocker_user_id = other_member.user_id and block.blocked_user_id = actor.id)
      ) as blocked
    from users actor
    join conversation_members own_member on own_member.user_id = actor.id
    join conversations conversation on conversation.id = own_member.conversation_id and conversation.state = 'active'
    join conversation_members other_member on other_member.conversation_id = conversation.id and other_member.user_id <> actor.id
    left join direct_message_requests request on request.conversation_id = conversation.id
    where actor.supabase_user_id = ${input.supabaseUserId}
      and conversation.id = ${input.conversationId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.blocked) throw new MessageBlockedError();
  if (requireAccepted && row.request_state !== null && row.request_state !== "accepted") {
    throw new MessageRequestForbiddenError();
  }
  return { actor_id: row.actor_id, other_user_id: row.other_user_id };
}

function resolveRequestTransition(
  existing: CreatorRequestRow,
  actorUserId: string,
  input: UpdateStructuredCreatorRequestInput
) {
  const creator = actorUserId === existing.creator_user_id;
  const requester = actorUserId === existing.requester_user_id;
  const action = input.body.action;
  let state: CreatorRequestRow["state"];
  if (action === "accept" && creator && existing.state === "proposed") state = "accepted";
  else if (action === "propose_terms" && creator && ["proposed", "terms_proposed"].includes(existing.state)) state = "terms_proposed";
  else if (action === "accept_terms" && requester && existing.state === "terms_proposed") state = "accepted";
  else if (action === "decline" && creator && ["proposed", "terms_proposed"].includes(existing.state)) state = "declined";
  else if (action === "mark_delivered" && creator && ["active", "remediation"].includes(existing.state)) state = "delivered";
  else if (action === "request_remediation" && requester && existing.state === "delivered") state = "remediation";
  else if (action === "complete" && requester && existing.state === "delivered") state = "completed";
  else if (action === "cancel" && requester && ["proposed", "terms_proposed", "accepted"].includes(existing.state) && !existing.payment_intent_id) state = "cancelled";
  else throw new MessageRequestForbiddenError();

  const agreedAmountMinor = input.body.agreedAmountMinor ?? existing.agreed_amount_minor ?? existing.proposed_amount_minor;
  if (["accept", "accept_terms", "propose_terms"].includes(action) && !agreedAmountMinor) {
    throw new MessageRequestForbiddenError();
  }
  return {
    state,
    agreedAmountMinor,
    expectedDeliveryDays: input.body.expectedDeliveryDays ?? existing.expected_delivery_days,
    clarificationRule: input.body.clarificationRule?.trim() ?? existing.clarification_rule,
    cancellationRule: input.body.cancellationRule?.trim() ?? existing.cancellation_rule
  };
}

function toMediaOffer(row: MediaOfferRow): CreatorMediaOffer {
  const state = row.expires_at.getTime() <= Date.now() && ["offered", "accepted"].includes(row.state)
    ? "expired"
    : row.state;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    creatorUserId: row.creator_user_id,
    buyerUserId: row.buyer_user_id,
    contentItemId: row.content_item_id,
    contentRevision: Number(row.content_revision),
    title: row.title,
    description: row.description,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state,
    paymentIntentId: row.payment_intent_id,
    expiresAt: row.expires_at.toISOString(),
    purchasedAt: row.purchased_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toCreatorRequest(row: CreatorRequestRow): StructuredCreatorRequest {
  const state = row.expires_at.getTime() <= Date.now() &&
    ["proposed", "terms_proposed", "accepted", "payment_pending"].includes(row.state)
    ? "expired"
    : row.state;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requesterUserId: row.requester_user_id,
    creatorUserId: row.creator_user_id,
    deliverable: row.deliverable,
    permittedCategory: row.permitted_category,
    proposedAmountMinor: row.proposed_amount_minor === null ? null : Number(row.proposed_amount_minor),
    agreedAmountMinor: row.agreed_amount_minor === null ? null : Number(row.agreed_amount_minor),
    currency: row.currency,
    expectedDeliveryDays: row.expected_delivery_days,
    clarificationRule: row.clarification_rule,
    cancellationRule: row.cancellation_rule,
    state,
    paymentIntentId: row.payment_intent_id,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    activatedAt: row.activated_at?.toISOString() ?? null,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function readReceipt<T>(sql: postgres.ISql, actorUserId: string, key: string) {
  const rows = await sql<{ action: string; request_hash: string; response_body: T }[]>`
    select action, request_hash, response_body
    from message_action_receipts
    where actor_user_id = ${actorUserId} and idempotency_key = ${key}
    limit 1
  `;
  return rows[0] ?? null;
}

function assertReplay<T>(receipt: { action: string; request_hash: string; response_body: T }, action: string, requestHash: string) {
  if (receipt.action !== action || receipt.request_hash !== requestHash) throw new MessageIdempotencyConflictError();
  return receipt.response_body;
}

async function writeReceipt<T>(
  sql: postgres.ISql,
  actorUserId: string,
  key: string,
  action: string,
  requestHash: string,
  conversationId: string,
  response: T
) {
  await sql`
    insert into message_action_receipts (
      actor_user_id, idempotency_key, action, request_hash, conversation_id, response_body
    ) values (
      ${actorUserId}, ${key}, ${action}, ${requestHash}, ${conversationId}, ${sql.json(response as never)}
    )
  `;
}

async function audit(
  sql: postgres.ISql,
  actorUserId: string,
  subjectType: string,
  subjectId: string,
  action: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>
) {
  await sql`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata)
    values (${randomUUID()}, ${actorUserId}, ${subjectType}, ${subjectId}, ${action}, ${idempotencyKey}, ${sql.json(metadata as never)})
    on conflict do nothing
  `;
}
