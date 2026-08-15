-- Never erase live request decisions or durable action receipts during a code rollback.
-- Roll back the application artifact while leaving this additive schema in place once used.
do $$
begin
  if exists (select 1 from message_action_receipts)
    or exists (select 1 from notification_action_receipts)
    or exists (
      select 1
      from direct_message_requests request
      left join private.migration_0095_legacy_direct_requests legacy
        on legacy.conversation_id = request.conversation_id
      where legacy.conversation_id is null
        or request.state <> 'accepted'
        or request.requester_message_count <> 0
    ) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = '0095 rollback refused because live message-request or idempotency state would be lost';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_message_requests'
  ) then
    alter publication supabase_realtime drop table direct_message_requests;
  end if;
end;
$$;

drop policy if exists notifications_select_self on notifications;
create policy notifications_select_self_or_staff
  on notifications for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

drop policy if exists direct_message_requests_select_participant on direct_message_requests;

drop policy if exists conversation_members_select_participant on conversation_members;
create policy conversation_members_select_member_or_staff
  on conversation_members for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = (select private.current_app_user_id())
    )
  );

drop policy if exists messages_select_visible_participant on messages;
create policy messages_select_conversation_member_or_staff
  on messages for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from conversation_members cm
      where cm.conversation_id = messages.conversation_id
        and cm.user_id = (select private.current_app_user_id())
    )
  );

drop function private.is_current_conversation_member(uuid);
drop function private.has_protected_app_access();

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select identity.user_id
  from public.user_provider_identities identity
  where identity.provider = 'supabase'
    and identity.provider_subject = (select auth.uid())::text
    and identity.status = 'active'
  limit 1
$$;

grant update on table notifications to authenticated;
grant insert, update on table notification_preferences to authenticated;
grant insert, update, delete on table notification_devices to authenticated;

create policy notifications_update_self_read_state
  on notifications for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_preferences_insert_self
  on notification_preferences for insert to authenticated
  with check (user_id = (select private.current_app_user_id()));

create policy notification_preferences_update_self_or_staff
  on notification_preferences for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_devices_insert_self
  on notification_devices for insert to authenticated
  with check (user_id = (select private.current_app_user_id()));

create policy notification_devices_update_self_or_staff
  on notification_devices for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_devices_delete_self_or_staff
  on notification_devices for delete to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

drop table notification_action_receipts;
drop table message_action_receipts;
drop table private.migration_0095_legacy_direct_requests;
drop table direct_message_requests;
