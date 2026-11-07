do $$
begin
  if exists (
    select 1
    from app_sessions
    where authentication_method = 'supabase_recovery'
      and revoked_at is null
      and expires_at > now()
  ) or exists (
    select 1
    from user_provider_identities
    where provider = 'supabase'
      and status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Cannot remove the recovery revocation boundary while active Supabase recovery authority exists';
  end if;
end
$$;

alter table app_sessions
  drop constraint app_sessions_provider_session_boundary_check,
  drop column provider_session_id;

alter table users
  drop column recovery_authentication_valid_after;
