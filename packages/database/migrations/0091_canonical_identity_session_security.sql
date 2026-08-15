-- Canonical WeVid identity, opaque application sessions, recovery linking, and provisional profiles.
-- Provider subjects map to one WeVid user. Matching provider emails never participate in linking.

create table user_provider_identities (
  id uuid primary key,
  provider text not null check (provider in ('privy', 'supabase')),
  provider_subject text not null,
  user_id uuid not null references users(id),
  status text not null default 'active' check (status in ('pending', 'active', 'revoked', 'blocked')),
  created_at timestamptz not null default now(),
  linked_at timestamptz,
  last_used_at timestamptz,
  unique (provider, provider_subject)
);

create index user_provider_identities_user_status_idx
  on user_provider_identities (user_id, status, created_at desc);

create unique index user_provider_identities_one_active_provider_idx
  on user_provider_identities (user_id, provider)
  where status = 'active';

insert into user_provider_identities (
  id,
  provider,
  provider_subject,
  user_id,
  status,
  created_at,
  linked_at,
  last_used_at
)
select
  gen_random_uuid(),
  'supabase',
  u.supabase_user_id::text,
  u.id,
  'active',
  u.created_at,
  u.created_at,
  u.updated_at
from users u
where u.supabase_user_id is not null
on conflict (provider, provider_subject) do nothing;

alter table users alter column supabase_user_id drop not null;

alter table wallet_auth_sessions rename to app_sessions;
alter index wallet_auth_sessions_user_created_idx rename to app_sessions_user_created_idx;
alter index wallet_auth_sessions_expires_at_idx rename to app_sessions_expires_at_idx;
alter index wallet_auth_sessions_wallet_idx rename to app_sessions_wallet_idx;

alter table app_sessions
  alter column wallet_id drop not null,
  add column provider_identity_id uuid references user_provider_identities(id),
  add column authentication_method text not null default 'wallet'
    check (authentication_method in ('wallet', 'privy', 'supabase_recovery')),
  add column authenticated_at timestamptz,
  add column rotated_from_session_id uuid references app_sessions(id);

update app_sessions set authenticated_at = created_at;

alter table app_sessions
  alter column authenticated_at set not null,
  alter column authenticated_at set default now();

create index app_sessions_provider_identity_idx
  on app_sessions (provider_identity_id)
  where provider_identity_id is not null;

create index app_sessions_active_user_idx
  on app_sessions (user_id, expires_at desc)
  where revoked_at is null;

alter policy wallet_auth_sessions_staff_select on app_sessions
  rename to app_sessions_staff_select;

create table recovery_link_intents (
  id uuid primary key,
  user_id uuid not null references users(id),
  session_id uuid not null references app_sessions(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index recovery_link_intents_user_created_idx
  on recovery_link_intents (user_id, created_at desc);
create index recovery_link_intents_expires_at_idx
  on recovery_link_intents (expires_at);

alter table user_provider_identities enable row level security;
alter table recovery_link_intents enable row level security;

grant select on table user_provider_identities to authenticated;
grant select on table recovery_link_intents to authenticated;

create policy user_provider_identities_staff_select
  on user_provider_identities for select to authenticated
  using ((select private.is_staff_member()));

create policy recovery_link_intents_staff_select
  on recovery_link_intents for select to authenticated
  using ((select private.is_staff_member()));

do $$
declare
  collision_handles text;
  invalid_handles text;
begin
  select string_agg(normalized_handle, ', ' order by normalized_handle)
  into collision_handles
  from (
    select lower(handle) as normalized_handle
    from profiles
    group by lower(handle)
    having count(*) > 1
    order by lower(handle)
    limit 20
  ) collisions;

  if collision_handles is not null then
    raise exception '0091 profile handle case collisions must be resolved before migration: %', collision_handles;
  end if;

  select string_agg(handle, ', ' order by handle)
  into invalid_handles
  from (
    select handle
    from profiles
    where lower(handle) !~ '^[a-z0-9_]{2,32}$'
      or lower(handle) in (
        'admin', 'administrator', 'api', 'app', 'auth', 'help', 'legal', 'login',
        'moderator', 'privacy', 'root', 'security', 'settings', 'staff', 'support',
        'system', 'terms', 'wevid', 'veel'
      )
    order by handle
    limit 20
  ) invalid;

  if invalid_handles is not null then
    raise exception '0091 invalid or reserved profile handles must be resolved before migration: %', invalid_handles;
  end if;
end
$$;

update profiles set handle = lower(handle) where handle <> lower(handle);

create unique index profiles_handle_lower_unique
  on profiles (lower(handle));

alter table profiles
  alter column visibility set default 'private',
  add constraint profiles_handle_normalized_check
    check (handle = lower(handle) and handle ~ '^[a-z0-9_]{2,32}$'),
  add constraint profiles_handle_reserved_check
    check (handle not in (
      'admin', 'administrator', 'api', 'app', 'auth', 'help', 'legal', 'login',
      'moderator', 'privacy', 'root', 'security', 'settings', 'staff', 'support',
      'system', 'terms', 'wevid', 'veel'
    ));

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

create or replace function private.is_staff_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_memberships membership
    join public.user_provider_identities identity on identity.user_id = membership.user_id
    where identity.provider = 'supabase'
      and identity.provider_subject = (select auth.uid())::text
      and identity.status = 'active'
      and membership.state = 'active'
  )
$$;
