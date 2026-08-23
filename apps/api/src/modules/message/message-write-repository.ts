import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  type MessageRow,
  messageSelectSql,
  toMessage
} from "./message-repository-mappers.js";
import {
  MessageBlockedError,
  MessageIdempotencyConflictError,
  MessageRequestForbiddenError,
  MessageRequestLimitError
} from "./message-errors.js";
import { readConversationByUserId } from "./message-read-repository.js";
import type {
  Conversation,
  ConversationInput,
  ConversationReadState,
  CreateDirectConversationInput,
  CreateMessageInput,
  CreatePaidMessageDraftInput,
  MarkConversationReadInput,
  RespondToMessageRequestInput,
  UpdateConversationMuteInput,
  UpdateMessageReactionInput
} from "./types.js";

interface ConversationContextRow {
  actor_id: string;
  other_user_id: string;
  conversation_state: string;
  request_state: "pending" | "accepted" | "declined" | null;
  initiator_user_id: string | null;
  recipient_user_id: string | null;
  requester_message_count: number | null;
}

interface MessageActionReceiptRow<T> {
  action: string;
  request_hash: string;
  conversation_id: string;
  response_body: T;
}

type MessageActionResponse = Conversation | ConversationReadState;

export async function createDirectConversation(
  sql: postgres.Sql,
  input: CreateDirectConversationInput
) {
  return sql.begin(async (transaction) => {
    const identities = await transaction<{
      actor_id: string;
      target_id: string;
    }[]>`
      select actor.id as actor_id, target.id as target_id
      from users actor
      join users target on target.id = ${input.targetUserId}
      join profiles target_profile on target_profile.user_id = target.id
      where actor.supabase_user_id = ${input.supabaseUserId}
        and actor.id <> target.id
        and actor.state = 'active'
        and target.state = 'active'
        and target_profile.visibility = 'public'
      limit 1
    `;
    const identity = identities[0];
    if (!identity) return null;

    await transaction`
      select id from users
      where id in (${identity.actor_id}, ${identity.target_id})
      order by id
      for update
    `;
    await assertNotBlocked(transaction, identity.actor_id, identity.target_id);

    const replay = await readMessageActionReceipt<Conversation>(
      transaction,
      identity.actor_id,
      input.idempotencyKey
    );
    if (replay) {
      assertReceiptMatches(replay, "conversation.create", input.requestHash);
      return replay.response_body;
    }

    const existing = await transaction<{ conversation_id: string }[]>`
      select conversation_id
      from direct_message_requests
      where least(initiator_user_id, recipient_user_id) = least(${identity.actor_id}::uuid, ${identity.target_id}::uuid)
        and greatest(initiator_user_id, recipient_user_id) = greatest(${identity.actor_id}::uuid, ${identity.target_id}::uuid)
      limit 1
      for update
    `;
    const conversationId = existing[0]?.conversation_id ?? randomUUID();

    if (!existing[0]) {
      const requestState = await hasTrustedRelationship(
        transaction,
        identity.actor_id,
        identity.target_id
      ) ? "accepted" : "pending";

      await transaction`
        insert into conversations (id, type, state)
        values (${conversationId}, 'direct', 'active')
      `;
      await transaction`
        insert into conversation_members (conversation_id, user_id)
        values (${conversationId}, ${identity.actor_id}), (${conversationId}, ${identity.target_id})
      `;
      await transaction`
        insert into direct_message_requests (
          conversation_id,
          initiator_user_id,
          recipient_user_id,
          state,
          responded_at
        ) values (
          ${conversationId},
          ${identity.actor_id},
          ${identity.target_id},
          ${requestState},
          ${requestState === "accepted" ? new Date() : null}
        )
      `;
    } else {
      await promoteTrustedMessageRequest(
        transaction,
        conversationId,
        identity.actor_id,
        identity.target_id
      );
    }

    const response = await readConversationByUserId(
      transaction,
      identity.actor_id,
      conversationId
    );
    if (!response) return null;
    await recordMessageAction(
      transaction,
      identity.actor_id,
      input.idempotencyKey,
      "conversation.create",
      input.requestHash,
      conversationId,
      response
    );
    await transaction`
      insert into audit_events (
        id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
      ) values (
        ${randomUUID()}, ${identity.actor_id}, 'conversation', ${conversationId},
        'conversation.created_or_reused', ${input.idempotencyKey},
        ${transaction.json({ targetUserId: identity.target_id, newConversation: !existing[0] })}
      ) on conflict do nothing
    `;

    return response;
  });
}

export async function respondToMessageRequest(
  sql: postgres.Sql,
  input: RespondToMessageRequestInput
) {
  return sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context) return null;
    const replay = await readMessageActionReceipt<Conversation>(
      transaction,
      context.actor_id,
      input.idempotencyKey
    );
    if (replay) {
      assertReceiptMatches(replay, "conversation.request.respond", input.requestHash);
      return replay.response_body;
    }
    if (
      context.request_state !== "pending" ||
      context.recipient_user_id !== context.actor_id
    ) {
      throw new MessageRequestForbiddenError();
    }
    if (input.action === "accept") {
      await assertNotBlocked(transaction, context.actor_id, context.other_user_id);
    }

    await transaction`
      update direct_message_requests
      set state = ${input.action === "accept" ? "accepted" : "declined"},
          responded_at = now(),
          updated_at = now()
      where conversation_id = ${input.conversationId}
    `;
    const response = await readConversationByUserId(
      transaction,
      context.actor_id,
      input.conversationId
    );
    if (!response) return null;
    await recordMessageAction(
      transaction,
      context.actor_id,
      input.idempotencyKey,
      "conversation.request.respond",
      input.requestHash,
      input.conversationId,
      response
    );
    await transaction`
      insert into audit_events (
        id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
      ) values (
        ${randomUUID()}, ${context.actor_id}, 'conversation', ${input.conversationId},
        ${input.action === "accept" ? "message_request.accepted" : "message_request.declined"},
        ${input.idempotencyKey}, '{}'::jsonb
      ) on conflict do nothing
    `;

    return response;
  });
}

export async function markConversationRead(
  sql: postgres.Sql,
  input: MarkConversationReadInput
) {
  return sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context) return null;
    if (context.request_state && context.request_state !== "accepted") {
      throw new MessageRequestForbiddenError();
    }
    const replay = await readMessageActionReceipt<ConversationReadState>(
      transaction,
      context.actor_id,
      input.idempotencyKey
    );
    if (replay) {
      assertReceiptMatches(replay, "conversation.read", input.requestHash);
      return replay.response_body;
    }

    const rows = await transaction<{ last_read_at: Date }[]>`
      update conversation_members
      set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), now())
      where conversation_id = ${input.conversationId}
        and user_id = ${context.actor_id}
      returning last_read_at
    `;
    const readAt = rows[0]?.last_read_at;
    if (!readAt) return null;

    const response = {
      conversationId: input.conversationId,
      unreadCount: 0 as const,
      readAt: readAt.toISOString()
    };
    await recordMessageAction(
      transaction,
      context.actor_id,
      input.idempotencyKey,
      "conversation.read",
      input.requestHash,
      input.conversationId,
      response
    );
    return response;
  });
}

export async function updateConversationMute(
  sql: postgres.Sql,
  input: UpdateConversationMuteInput
) {
  return sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context) return null;
    const replay = await readMessageActionReceipt<Conversation>(
      transaction,
      context.actor_id,
      input.idempotencyKey
    );
    if (replay) {
      assertReceiptMatches(replay, "conversation.mute", input.requestHash);
      return replay.response_body;
    }
    await transaction`
      update conversation_members
      set muted_at = ${input.muted ? new Date() : null}
      where conversation_id = ${input.conversationId}
        and user_id = ${context.actor_id}
    `;
    const response = await readConversationByUserId(transaction, context.actor_id, input.conversationId);
    if (!response) return null;
    await recordMessageAction(
      transaction,
      context.actor_id,
      input.idempotencyKey,
      "conversation.mute",
      input.requestHash,
      input.conversationId,
      response
    );
    return response;
  });
}

export async function createMessage(sql: postgres.Sql, input: CreateMessageInput) {
  return sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context) return null;
    if (context.conversation_state !== "active") {
      throw new MessageRequestForbiddenError();
    }
    await assertNotBlocked(transaction, context.actor_id, context.other_user_id);
    await promoteTrustedMessageRequest(
      transaction,
      input.conversationId,
      context.actor_id,
      context.other_user_id,
      context
    );

    const existing = await transaction<{
      id: string;
      conversation_id: string;
      body: string;
      reply_to_message_id: string | null;
      shared_content_item_id: string | null;
      attachment_content_item_ids: string[];
    }[]>`
      select m.id, m.conversation_id, m.body, m.reply_to_message_id, m.shared_content_item_id,
        coalesce((
          select array_agg(a.content_item_id::text order by a.position)
          from message_attachments a where a.message_id = m.id
        ), array[]::text[]) as attachment_content_item_ids
      from messages m
      where m.sender_user_id = ${context.actor_id}
        and m.idempotency_key = ${input.idempotencyKey}
      limit 1
    `;
    if (existing[0]) {
      const requestedAttachmentIds = input.attachmentContentItemIds ?? [];
      if (
        existing[0].conversation_id !== input.conversationId ||
        existing[0].body !== input.body ||
        existing[0].reply_to_message_id !== (input.replyToMessageId ?? null) ||
        existing[0].shared_content_item_id !== (input.sharedContentItemId ?? null) ||
        existing[0].attachment_content_item_ids.join(",") !== requestedAttachmentIds.join(",")
      ) {
        throw new MessageIdempotencyConflictError();
      }
      return readMessage(transaction, existing[0].id, context.actor_id);
    }

    if (context.request_state === "declined") {
      throw new MessageRequestForbiddenError();
    }
    if (context.request_state === "pending") {
      if (context.initiator_user_id !== context.actor_id) {
        throw new MessageRequestForbiddenError();
      }
      if (Number(context.requester_message_count) >= 1) {
        throw new MessageRequestLimitError();
      }
    }

    if (input.replyToMessageId) {
      const referenced = await transaction<{ id: string }[]>`
        select id from messages
        where id = ${input.replyToMessageId}
          and conversation_id = ${input.conversationId}
          and delivery_state = 'visible'
        limit 1
      `;
      if (!referenced[0]) throw new MessageRequestForbiddenError();
    }
    if (input.sharedContentItemId) {
      const shareable = await transaction<{ id: string }[]>`
        select id from content_items
        where id = ${input.sharedContentItemId}
          and state = 'ready'
          and publish_state = 'published'
          and moderation_state = 'approved'
        limit 1
      `;
      if (!shareable[0]) throw new MessageRequestForbiddenError();
    }
    const attachmentIds = [...new Set(input.attachmentContentItemIds ?? [])];
    if (attachmentIds.length > 4) throw new MessageRequestForbiddenError();
    if (attachmentIds.length > 0) {
      const approvedAttachments = await transaction<{ id: string }[]>`
        select id
        from content_items
        where id in ${transaction(attachmentIds)}
          and creator_user_id = ${context.actor_id}
          and state = 'ready'
          and publish_state = 'published'
          and moderation_state = 'approved'
      `;
      if (approvedAttachments.length !== attachmentIds.length) {
        throw new MessageRequestForbiddenError();
      }
    }

    const messageId = randomUUID();
    await transaction`
      insert into messages (
        id, conversation_id, sender_user_id, body, idempotency_key,
        reply_to_message_id, shared_content_item_id
      ) values (
        ${messageId}, ${input.conversationId}, ${context.actor_id}, ${input.body},
        ${input.idempotencyKey}, ${input.replyToMessageId ?? null}, ${input.sharedContentItemId ?? null}
      )
    `;
    for (const [position, contentItemId] of attachmentIds.entries()) {
      await transaction`
        insert into message_attachments (message_id, content_item_id, content_revision, position)
        select ${messageId}, id, asset_revision, ${position}
        from content_items
        where id = ${contentItemId}
      `;
    }
    if (context.request_state === "pending") {
      await transaction`
        update direct_message_requests
        set requester_message_count = requester_message_count + 1, updated_at = now()
        where conversation_id = ${input.conversationId}
      `;
    }

    await transaction`
      insert into notifications (
        id, user_id, kind, title, body, action_url,
        related_resource_type, related_resource_id, idempotency_key
      )
      select
        ${randomUUID()}, ${context.other_user_id}, 'message',
        'New message', '@' || sender_profile.handle || ' sent you a message.',
        '/app/messages?conversation=' || ${input.conversationId},
        'message', ${messageId}, 'message:' || ${messageId}
      from profiles sender_profile
      where sender_profile.user_id = ${context.actor_id}
      on conflict (user_id, idempotency_key) do nothing
    `;
    await transaction`
      insert into audit_events (
        id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
      ) values (
        ${randomUUID()}, ${context.actor_id}, 'message', ${messageId}, 'message.sent',
        ${input.idempotencyKey}, ${transaction.json({ conversationId: input.conversationId })}
      ) on conflict do nothing
    `;

    return readMessage(transaction, messageId, context.actor_id);
  });
}

export async function updateMessageReaction(
  sql: postgres.Sql,
  input: UpdateMessageReactionInput
) {
  return sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context || (context.request_state && context.request_state !== "accepted")) return null;
    const message = await transaction<{ id: string }[]>`
      select id from messages
      where id = ${input.messageId}
        and conversation_id = ${input.conversationId}
        and delivery_state = 'visible'
      for update
    `;
    if (!message[0]) return null;
    if (input.reacted) {
      await transaction`
        insert into message_reactions (message_id, user_id, reaction_key)
        values (${input.messageId}, ${context.actor_id}, ${input.reactionKey})
        on conflict do nothing
      `;
    } else {
      await transaction`
        delete from message_reactions
        where message_id = ${input.messageId}
          and user_id = ${context.actor_id}
          and reaction_key = ${input.reactionKey}
      `;
    }
    return readMessage(transaction, input.messageId, context.actor_id);
  });
}

async function readMessage(sql: postgres.ISql, messageId: string, viewerUserId: string) {
  const rows = await sql<MessageRow[]>`
    ${messageSelectSql(sql, viewerUserId)}
    where m.id = ${messageId}
  `;
  return rows[0] ? toMessage(rows[0]) : null;
}

async function lockConversationContext(
  transaction: postgres.TransactionSql,
  input: ConversationInput
): Promise<ConversationContextRow | null> {
  const rows = await transaction<ConversationContextRow[]>`
    with actor as (
      select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
    )
    select
      actor.id as actor_id,
      other_member.user_id as other_user_id,
      c.state as conversation_state,
      request.state as request_state,
      request.initiator_user_id,
      request.recipient_user_id,
      request.requester_message_count
    from actor
    join conversation_members own_member on own_member.user_id = actor.id
    join conversations c on c.id = own_member.conversation_id
    join conversation_members other_member
      on other_member.conversation_id = c.id and other_member.user_id <> actor.id
    left join direct_message_requests request on request.conversation_id = c.id
    where c.id = ${input.conversationId}
    limit 1
    for update of c, own_member, other_member
  `;
  const context = rows[0];
  if (!context) return null;

  await transaction`
    select id from users
    where id in (${context.actor_id}, ${context.other_user_id})
    order by id
    for update
  `;
  if (context.request_state) {
    const request = await transaction<Pick<
      ConversationContextRow,
      "request_state" | "initiator_user_id" | "recipient_user_id" | "requester_message_count"
    >[]>`
      select
        state as request_state,
        initiator_user_id,
        recipient_user_id,
        requester_message_count
      from direct_message_requests
      where conversation_id = ${input.conversationId}
      for update
    `;
    Object.assign(context, request[0]);
  }

  return context;
}

async function assertNotBlocked(
  transaction: postgres.TransactionSql,
  userAId: string,
  userBId: string
) {
  const rows = await transaction<{ blocked: boolean }[]>`
    select exists (
      select 1 from blocks
      where (blocker_user_id = ${userAId} and blocked_user_id = ${userBId})
         or (blocker_user_id = ${userBId} and blocked_user_id = ${userAId})
    ) as blocked
  `;
  if (rows[0]?.blocked) throw new MessageBlockedError();
}

async function hasTrustedRelationship(
  transaction: postgres.TransactionSql,
  userAId: string,
  userBId: string
) {
  const rows = await transaction<{ trusted: boolean }[]>`
    select (
      (
        exists (
          select 1 from user_follows
          where follower_user_id = ${userAId}
            and followed_user_id = ${userBId}
            and state = 'active'
        )
        and exists (
          select 1 from user_follows
          where follower_user_id = ${userBId}
            and followed_user_id = ${userAId}
            and state = 'active'
        )
      )
      or exists (
        select 1 from mutuals
        where user_a_id = least(${userAId}::uuid, ${userBId}::uuid)
          and user_b_id = greatest(${userAId}::uuid, ${userBId}::uuid)
          and state = 'active'
      )
    ) as trusted
  `;
  return Boolean(rows[0]?.trusted);
}

async function promoteTrustedMessageRequest(
  transaction: postgres.TransactionSql,
  conversationId: string,
  userAId: string,
  userBId: string,
  context?: ConversationContextRow
) {
  if (context && context.request_state !== "pending") return;
  if (!await hasTrustedRelationship(transaction, userAId, userBId)) return;

  const updated = await transaction<{ state: "accepted" }[]>`
    update direct_message_requests
    set state = 'accepted', responded_at = coalesce(responded_at, now()), updated_at = now()
    where conversation_id = ${conversationId}
      and state = 'pending'
    returning state
  `;
  if (updated[0] && context) context.request_state = "accepted";
}

async function readMessageActionReceipt<T extends MessageActionResponse>(
  transaction: postgres.TransactionSql,
  actorUserId: string,
  idempotencyKey: string
) {
  const rows = await transaction<MessageActionReceiptRow<T>[]>`
    select action, request_hash, conversation_id, response_body
    from message_action_receipts
    where actor_user_id = ${actorUserId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  return rows[0] ?? null;
}

function assertReceiptMatches<T extends MessageActionResponse>(
  receipt: MessageActionReceiptRow<T>,
  action: string,
  requestHash: string
) {
  if (receipt.action !== action || receipt.request_hash !== requestHash) {
    throw new MessageIdempotencyConflictError();
  }
}

async function recordMessageAction(
  transaction: postgres.TransactionSql,
  actorUserId: string,
  idempotencyKey: string,
  action: string,
  requestHash: string,
  conversationId: string,
  response: MessageActionResponse
) {
  await transaction`
    insert into message_action_receipts (
      actor_user_id, idempotency_key, action, request_hash, conversation_id, response_body
    ) values (
      ${actorUserId}, ${idempotencyKey}, ${action}, ${requestHash}, ${conversationId},
      ${transaction.json(response)}
    )
  `;
}

export async function findConversationPrice(sql: postgres.Sql, input: ConversationInput) {
  const rows = await sql<{ recipient_user_id: string }[]>`
    with actor as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select recipient.user_id as recipient_user_id
    from actor
    join conversation_members own_member
      on own_member.conversation_id = ${input.conversationId}
      and own_member.user_id = actor.id
    join conversations c on c.id = own_member.conversation_id and c.state = 'active'
    join conversation_members recipient
      on recipient.conversation_id = c.id and recipient.user_id <> actor.id
    left join direct_message_requests request on request.conversation_id = c.id
    where not exists (
      select 1 from blocks b
      where (b.blocker_user_id = actor.id and b.blocked_user_id = recipient.user_id)
         or (b.blocker_user_id = recipient.user_id and b.blocked_user_id = actor.id)
    )
      and coalesce(request.state, 'accepted') = 'accepted'
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
  await sql.begin(async (transaction) => {
    const context = await lockConversationContext(transaction, input);
    if (!context || context.conversation_state !== "active") {
      throw new MessageRequestForbiddenError();
    }
    await assertNotBlocked(transaction, context.actor_id, context.other_user_id);
    if (context.request_state && context.request_state !== "accepted") {
      throw new MessageRequestForbiddenError();
    }

    await transaction`
      insert into paid_message_delivery_requests (
        payment_intent_id,
        conversation_id,
        sender_user_id,
        recipient_user_id,
        body,
        amount_minor,
        currency
      ) values (
        ${input.paymentIntentId},
        ${input.conversationId},
        ${context.actor_id},
        ${context.other_user_id},
        ${input.body},
        ${input.amountMinor},
        ${input.currency}
      )
      on conflict (payment_intent_id) do nothing
    `;
  });
}
