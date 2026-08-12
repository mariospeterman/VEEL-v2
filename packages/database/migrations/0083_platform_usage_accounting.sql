-- Canonical public-media allowance accounting and corrected tier authority.

update platform_tier_policies
set
  capabilities = capabilities - 'profile_membership',
  updated_at = now()
where tier_key = 'veel_studio';

create table platform_playback_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  target_type text not null check (target_type in ('content', 'live_room')),
  target_id uuid not null,
  state text not null default 'active' check (state in ('active', 'exhausted', 'closed', 'expired')),
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  consumed_seconds bigint not null default 0 check (consumed_seconds >= 0),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  last_heartbeat_at timestamptz not null default now(),
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (window_ends_at > window_starts_at)
);

create table platform_playback_heartbeats (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references platform_playback_sessions(id),
  sequence integer not null check (sequence > 0),
  reported_seconds integer not null check (reported_seconds between 1 and 30),
  credited_seconds integer not null check (credited_seconds between 0 and 30),
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  unique (session_id, idempotency_key)
);

create index platform_playback_sessions_user_state_idx
  on platform_playback_sessions (user_id, state, updated_at desc);

create index platform_playback_sessions_target_idx
  on platform_playback_sessions (target_type, target_id, created_at desc);

create index platform_playback_heartbeats_session_created_idx
  on platform_playback_heartbeats (session_id, created_at desc);

alter table platform_playback_sessions enable row level security;
alter table platform_playback_heartbeats enable row level security;

grant select on table platform_playback_sessions to authenticated;
grant select on table platform_playback_heartbeats to authenticated;

create policy platform_playback_sessions_select_self_or_staff
  on platform_playback_sessions for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy platform_playback_heartbeats_select_self_or_staff
  on platform_playback_heartbeats for select to authenticated
  using (
    exists (
      select 1
      from platform_playback_sessions session
      where session.id = platform_playback_heartbeats.session_id
        and session.user_id = (select private.current_app_user_id())
    )
    or (select private.is_staff_member())
  );
