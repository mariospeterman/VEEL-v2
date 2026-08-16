do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_chat_messages'
  ) then
    alter publication supabase_realtime drop table live_chat_messages;
  end if;
end $$;

drop policy if exists live_chat_messages_select_participant_or_staff on live_chat_messages;
create policy live_chat_messages_select_participant_or_staff
  on live_chat_messages for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_chat_messages.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
    or exists (
      select 1
      from live_passes lp
      where lp.room_id = live_chat_messages.room_id
        and lp.user_id = (select private.current_app_user_id())
        and lp.state = 'active'
        and lp.expires_at > now()
    )
  );

drop table if exists live_room_control_actions;

drop index if exists live_chat_messages_actor_idempotency_idx;
alter table live_chat_messages
  drop constraint if exists live_chat_messages_idempotency_pair_check,
  drop column if exists request_hash,
  drop column if exists idempotency_key;

drop index if exists live_rooms_suspended_by_user_id_idx;
alter table live_rooms
  drop constraint if exists live_rooms_provider_creation_attempt_count_check,
  drop constraint if exists live_rooms_event_price_safe_integer_check,
  drop constraint if exists live_rooms_state_before_suspension_check,
  drop constraint if exists live_rooms_suspension_reason_check,
  drop constraint if exists live_rooms_state_check,
  drop column if exists state_before_suspension,
  drop column if exists suspension_reason,
  drop column if exists suspended_by_user_id,
  drop column if exists suspended_at,
  drop column if exists provider_creation_attempt_count,
  drop column if exists provider_creation_claim_expires_at,
  drop column if exists provider_creation_claim_id;
