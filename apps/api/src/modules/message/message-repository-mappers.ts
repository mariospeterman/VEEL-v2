import type postgres from "postgres";
import type { Conversation, Message } from "./types.js";

export interface ConversationRow {
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

export interface MessageRow {
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

export function messageSelectSql(sql: postgres.Sql) {
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

export function toConversation(row: ConversationRow): Conversation {
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

export function toMessage(row: MessageRow): Message {
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
