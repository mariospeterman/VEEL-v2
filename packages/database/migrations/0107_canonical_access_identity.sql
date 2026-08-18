-- Keep the legacy compatibility column from ever becoming a second identity
-- authority while account-access repositories finish moving to users.id.
-- New canonical users may leave the column null; historical rows may retain
-- only the canonical WeVid user id.

do $$
begin
  if exists (
    select 1
    from users u
    where u.supabase_user_id is not null
      and u.supabase_user_id <> u.id
      and not exists (
        select 1
        from user_provider_identities identity
        where identity.provider = 'supabase'
          and identity.provider_subject = u.supabase_user_id::text
          and identity.user_id = u.id
      )
  ) then
    raise exception
      'cannot canonicalize users.supabase_user_id before preserving its provider identity mapping';
  end if;
end
$$;

update users
set supabase_user_id = id
where supabase_user_id is not null
  and supabase_user_id <> id;

alter table users
  add constraint users_legacy_supabase_id_canonical_check
  check (supabase_user_id is null or supabase_user_id = id)
  not valid;

alter table users
  validate constraint users_legacy_supabase_id_canonical_check;
