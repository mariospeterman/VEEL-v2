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
  sql: postgres.ISql,
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
      c.state as conversation_state,
      coalesce(other_profile.display_name, 'Conversation') as title,
      other_user.id as counterpart_id,
      coalesce(other_profile.handle, 'unknown') as counterpart_handle,
      coalesce(other_profile.display_name, 'Unknown') as counterpart_display_name,
      other_profile.avatar_url as counterpart_avatar_url,
      coalesce(unread.unread_count, 0)::int as unread_count,
      request.state as request_state,
      case
        when request.initiator_user_id = own_member.user_id then 'initiator'
        when request.recipient_user_id = own_member.user_id then 'recipient'
        else null
      end as request_role,
      request.requester_message_count,
      exists (
        select 1 from blocks b
        where (b.blocker_user_id = own_member.user_id and b.blocked_user_id = other_member.user_id)
           or (b.blocker_user_id = other_member.user_id and b.blocked_user_id = own_member.user_id)
      ) as relationship_blocked,
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
    left join users other_user on other_user.id = other_member.user_id
    left join direct_message_requests request on request.conversation_id = c.id
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
    left join lateral (
      select count(*)::int as unread_count
      from messages m_unread
      where m_unread.conversation_id = c.id
        and m_unread.sender_user_id <> own_member.user_id
        and m_unread.delivery_state = 'visible'
        and (own_member.last_read_at is null or m_unread.created_at > own_member.last_read_at)
    ) unread on true
    where own_member.user_id = (select id from actor)
    order by coalesce(last_message.created_at, c.created_at) desc
  `;

  return {
    items: rows.map(toConversation)
  };
}

export async function readConversationByUserId(
  sql: postgres.ISql,
  userId: string,
  conversationId: string
) {
  const rows = await sql<ConversationRow[]>`
    select
      c.id,
      c.type,
      c.state as conversation_state,
      coalesce(other_profile.display_name, 'Conversation') as title,
      other_user.id as counterpart_id,
      coalesce(other_profile.handle, 'unknown') as counterpart_handle,
      coalesce(other_profile.display_name, 'Unknown') as counterpart_display_name,
      other_profile.avatar_url as counterpart_avatar_url,
      coalesce(unread.unread_count, 0)::int as unread_count,
      request.state as request_state,
      case
        when request.initiator_user_id = own_member.user_id then 'initiator'
        when request.recipient_user_id = own_member.user_id then 'recipient'
        else null
      end as request_role,
      request.requester_message_count,
      exists (
        select 1 from blocks b
        where (b.blocker_user_id = own_member.user_id and b.blocked_user_id = other_member.user_id)
           or (b.blocker_user_id = other_member.user_id and b.blocked_user_id = own_member.user_id)
      ) as relationship_blocked,
      last_message.body as last_body,
      last_message.created_at as last_created_at,
      last_sender.id as last_sender_id,
      last_sender_profile.handle as last_sender_handle,
      last_sender_profile.display_name as last_sender_display_name,
      last_sender_profile.avatar_url as last_sender_avatar_url
    from conversation_members own_member
    join conversations c on c.id = own_member.conversation_id
    join conversation_members other_member
      on other_member.conversation_id = c.id and other_member.user_id <> own_member.user_id
    join users other_user on other_user.id = other_member.user_id
    left join profiles other_profile on other_profile.user_id = other_member.user_id
    left join direct_message_requests request on request.conversation_id = c.id
    left join lateral (
      select * from messages m
      where m.conversation_id = c.id and m.delivery_state = 'visible'
      order by m.created_at desc
      limit 1
    ) last_message on true
    left join users last_sender on last_sender.id = last_message.sender_user_id
    left join profiles last_sender_profile on last_sender_profile.user_id = last_sender.id
    left join lateral (
      select count(*)::int as unread_count
      from messages m_unread
      where m_unread.conversation_id = c.id
        and m_unread.sender_user_id <> own_member.user_id
        and m_unread.delivery_state = 'visible'
        and (own_member.last_read_at is null or m_unread.created_at > own_member.last_read_at)
    ) unread on true
    where own_member.user_id = ${userId}
      and c.id = ${conversationId}
    limit 1
  `;

  return rows[0] ? toConversation(rows[0]) : null;
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
