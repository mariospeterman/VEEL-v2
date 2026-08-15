create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.users u
  where u.supabase_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.is_staff_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join public.users u on u.id = sm.user_id
    where u.supabase_user_id = (select auth.uid())
      and sm.state = 'active'
  )
$$;

alter table profiles
  drop constraint if exists profiles_handle_reserved_check,
  drop constraint if exists profiles_handle_normalized_check,
  alter column visibility set default 'public';

drop index if exists profiles_handle_lower_unique;

drop policy if exists recovery_link_intents_staff_select on recovery_link_intents;
drop policy if exists user_provider_identities_staff_select on user_provider_identities;
revoke select on table recovery_link_intents from authenticated;
revoke select on table user_provider_identities from authenticated;
alter table recovery_link_intents disable row level security;
alter table user_provider_identities disable row level security;

drop index if exists recovery_link_intents_expires_at_idx;
drop index if exists recovery_link_intents_user_created_idx;
drop table if exists recovery_link_intents;

delete from app_sessions where wallet_id is null;
drop index if exists app_sessions_active_user_idx;
drop index if exists app_sessions_provider_identity_idx;

alter policy app_sessions_staff_select on app_sessions
  rename to wallet_auth_sessions_staff_select;

alter table app_sessions
  drop column if exists rotated_from_session_id,
  drop column if exists authenticated_at,
  drop column if exists authentication_method,
  drop column if exists provider_identity_id,
  alter column wallet_id set not null;

alter index app_sessions_wallet_idx rename to wallet_auth_sessions_wallet_idx;
alter index app_sessions_expires_at_idx rename to wallet_auth_sessions_expires_at_idx;
alter index app_sessions_user_created_idx rename to wallet_auth_sessions_user_created_idx;
alter table app_sessions rename to wallet_auth_sessions;

drop index if exists user_provider_identities_user_status_idx;
drop index if exists user_provider_identities_one_active_provider_idx;
drop table if exists user_provider_identities;

update users set supabase_user_id = id where supabase_user_id is null;
alter table users alter column supabase_user_id set not null;
