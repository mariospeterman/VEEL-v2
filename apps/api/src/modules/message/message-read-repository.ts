import type postgres from "postgres";
import {
  type ConversationRow,
  type MessageRow,
  messageSelectSql,
  toConversation,
  toMessage
} from "./message-repository-mappers.js";
import type { ConversationInput, ListConversationsInput } from "./types.js";

export async function listConversations(
  sql: postgres.Sql,
  input: ListConversationsInput
) {
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
}

export async function listMessages(sql: postgres.Sql, input: ConversationInput) {
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
