-- Roll back Convergence 05 only before the new messaging/live product tables receive traffic.

do $$
begin
  if exists (select 1 from message_reactions)
     or exists (select 1 from creator_media_offers)
     or exists (select 1 from structured_creator_requests)
     or exists (select 1 from live_safety_monitoring_events)
     or exists (select 1 from live_safety_provider_actions)
     or exists (select 1 from realtime_connection_events)
     or exists (select 1 from messages where reply_to_message_id is not null or shared_content_item_id is not null) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = '0112 rollback requires retained Convergence 05 traffic to be migrated first';
  end if;
end;
$$;

drop trigger if exists live_safety_sessions_broadcast_invalidation on live_safety_sessions;
drop trigger if exists live_chat_messages_broadcast_invalidation on live_chat_messages;
drop trigger if exists live_rooms_broadcast_invalidation on live_rooms;
drop trigger if exists structured_creator_requests_broadcast_invalidation on structured_creator_requests;
drop trigger if exists creator_media_offers_broadcast_invalidation on creator_media_offers;
drop trigger if exists message_reactions_broadcast_invalidation on message_reactions;
drop trigger if exists direct_message_requests_broadcast_invalidation on direct_message_requests;
drop trigger if exists conversation_members_broadcast_invalidation on conversation_members;
drop trigger if exists messages_broadcast_invalidation on messages;
drop trigger if exists notifications_broadcast_invalidation on notifications;
drop trigger if exists media_safety_cases_live_release_guard on media_safety_cases;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists wevid_scoped_receive on realtime.messages';
    execute 'drop policy if exists wevid_scoped_send on realtime.messages';
  end if;
end;
$$;

drop function if exists private.broadcast_live_projection_change();
drop function if exists private.broadcast_conversation_projection_change();
drop function if exists private.broadcast_account_projection_change();
drop function if exists private.emit_realtime_invalidation(text, text, text, uuid);
drop function if exists private.realtime_topic_can_send(text, text);
drop function if exists private.realtime_topic_can_receive(text, text);
drop function if exists private.realtime_live_access(uuid);
drop function if exists private.realtime_conversation_access(uuid);
drop function if exists private.enforce_live_safety_release();
drop function if exists private.live_safety_release_ready(uuid);

drop table if exists realtime_connection_events;
drop table if exists realtime_topic_versions;
drop table if exists live_safety_provider_actions;
drop table if exists live_safety_monitoring_events;
drop table if exists live_safety_sessions;
drop table if exists structured_creator_requests;
drop table if exists creator_media_offers;
drop table if exists message_reactions;

drop index if exists messages_shared_content_idx;
drop index if exists messages_reply_idx;

alter table messages
  drop column if exists shared_content_item_id,
  drop column if exists reply_to_message_id;

alter table conversation_members
  drop column if exists muted_at;

-- Keep upgraded live safety cases fail closed. Rollback must never recreate
-- creator-attestation-only public release.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
      alter publication supabase_realtime add table conversation_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_message_requests') then
      alter publication supabase_realtime add table direct_message_requests;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_chat_messages') then
      alter publication supabase_realtime add table live_chat_messages;
    end if;
  end if;
end;
$$;
