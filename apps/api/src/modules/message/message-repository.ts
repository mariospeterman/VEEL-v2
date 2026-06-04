import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { Conversation, Message, MessageRepository } from "./types.js";

export class MessageRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "MessageRepositoryConfigurationError";
  }
}

interface ConversationRow {
  id: string;
  type: Conversation["type"];
  title: string;
  unread_count: number;
  last_body: string | null;
  last_created_at: Date | null;
  last_sender_id: string | null;
  last_sender_handle: string | null;
  last_sender_display_name: string | null;
  last_sender_avatar_url: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  body: string;
  delivery_state: Message["deliveryState"];
  payment_intent_id: string | null;
  created_at: Date;
  sender_id: string;
  sender_handle: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
}

export function createPostgresMessageRepository(databaseUrl?: string): MessageRepository {
  if (!databaseUrl) {
    return {
      async listConversations() {
        throw new MessageRepositoryConfigurationError();
      },
      async listMessages() {
        throw new MessageRepositoryConfigurationError();
      },
      async createMessage() {
        throw new MessageRepositoryConfigurationError();
      },
      async findConversationPrice() {
        throw new MessageRepositoryConfigurationError();
      },
      async recordPaidMessageDraft() {
        throw new MessageRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listConversations(input) {
      const rows = await sql<ConversationRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          c.id,
          c.type,
          coalesce(other_profile.display_name, 'Conversation') as title,
          count(m_unread.id)::int as unread_count,
          last_message.body as last_body,
          last_message.created_at as last_created_at,
          last_sender.id as last_sender_id,
          last_sender_profile.handle as last_sender_handle,
          last_sender_profile.display_name as last_sender_display_name,
          last_sender_profile.avatar_url as last_sender_avatar_url
        from conversation_members own_member
        join conversations c on c.id = own_member.conversation_id
        left join conversation_members other_member
          on other_member.conversation_id = c.id
          and other_member.user_id <> own_member.user_id
        left join profiles other_profile on other_profile.user_id = other_member.user_id
        left join lateral (
          select *
          from messages m
          where m.conversation_id = c.id
            and m.delivery_state = 'visible'
          order by m.created_at desc
          limit 1
        ) last_message on true
        left join users last_sender on last_sender.id = last_message.sender_user_id
        left join profiles last_sender_profile on last_sender_profile.user_id = last_sender.id
        left join messages m_unread
          on m_unread.conversation_id = c.id
          and m_unread.sender_user_id <> own_member.user_id
          and m_unread.delivery_state = 'visible'
          and (own_member.last_read_at is null or m_unread.created_at > own_member.last_read_at)
        where own_member.user_id = (select id from actor)
        group by
          c.id,
          other_profile.display_name,
          last_message.body,
          last_message.created_at,
          last_sender.id,
          last_sender_profile.handle,
          last_sender_profile.display_name,
          last_sender_profile.avatar_url
        order by coalesce(last_message.created_at, c.created_at) desc
      `;

      return {
        items: rows.map(toConversation)
      };
    },
    async listMessages(input) {
      const participant = await isParticipant(sql, input.supabaseUserId, input.conversationId);

      if (!participant) {
        return null;
      }

      const rows = await sql<MessageRow[]>`
        ${messageSelectSql(sql)}
        where m.conversation_id = ${input.conversationId}
          and m.delivery_state = 'visible'
        order by m.created_at desc
        limit 50
      `;

      return {
        items: rows.reverse().map(toMessage)
      };
    },
    async createMessage(input) {
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
    },
    async findConversationPrice(input) {
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
            currency: "SOL",
            recipientUserId: row.recipient_user_id
          }
        : null;
    },
    async recordPaidMessageDraft(input) {
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
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

async function isParticipant(
  sql: postgres.Sql,
  supabaseUserId: string,
  conversationId: string
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select true as ok
    from conversation_members cm
    join users u on u.id = cm.user_id
    where u.supabase_user_id = ${supabaseUserId}
      and cm.conversation_id = ${conversationId}
    limit 1
  `;

  return Boolean(rows[0]?.ok);
}

function messageSelectSql(sql: postgres.Sql) {
  return sql`
    select
      m.id,
      m.conversation_id,
      m.body,
      m.delivery_state,
      m.payment_intent_id,
      m.created_at,
      u.id as sender_id,
      p.handle as sender_handle,
      p.display_name as sender_display_name,
      p.avatar_url as sender_avatar_url
    from messages m
    join users u on u.id = m.sender_user_id
    join profiles p on p.user_id = u.id
  `;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    unreadCount: Number(row.unread_count),
    ...(row.last_body && row.last_created_at && row.last_sender_id
      ? {
          lastMessage: {
            body: row.last_body,
            createdAt: row.last_created_at.toISOString(),
            sender: {
              id: row.last_sender_id,
              handle: row.last_sender_handle ?? "unknown",
              displayName: row.last_sender_display_name ?? "Unknown",
              avatarUrl: row.last_sender_avatar_url,
              badges: []
            }
          }
        }
      : {})
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: {
      id: row.sender_id,
      handle: row.sender_handle,
      displayName: row.sender_display_name,
      avatarUrl: row.sender_avatar_url,
      badges: []
    },
    body: row.body,
    deliveryState: row.delivery_state,
    paymentIntentId: row.payment_intent_id,
    createdAt: row.created_at.toISOString()
  };
}
