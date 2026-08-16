-- Launch 07: SFW live control receipts, canonical moderation handoff, and idempotent chat.

alter table live_rooms
  add column provider_creation_claim_id uuid,
  add column provider_creation_claim_expires_at timestamptz,
  add column provider_creation_attempt_count integer not null default 0,
  add column suspended_at timestamptz,
  add column suspended_by_user_id uuid references users(id),
  add column suspension_reason text,
  add column state_before_suspension text;

alter table live_rooms
  add constraint live_rooms_state_check
    check (state in ('scheduled', 'waiting', 'live', 'suspended', 'ended', 'replay_ready')),
  add constraint live_rooms_suspension_reason_check
    check (suspension_reason is null or char_length(suspension_reason) between 1 and 1000),
  add constraint live_rooms_state_before_suspension_check
    check (state_before_suspension is null or state_before_suspension in ('scheduled', 'waiting', 'live')),
  add constraint live_rooms_event_price_safe_integer_check
    check (event_price_minor is null or event_price_minor <= 9007199254740991),
  add constraint live_rooms_provider_creation_attempt_count_check
    check (provider_creation_attempt_count >= 0);

create index live_rooms_suspended_by_user_id_idx
  on live_rooms (suspended_by_user_id)
  where suspended_by_user_id is not null;

alter table live_chat_messages
  add column idempotency_key text,
  add column request_hash text;

alter table live_chat_messages
  add constraint live_chat_messages_idempotency_pair_check
    check ((idempotency_key is null) = (request_hash is null));

create unique index live_chat_messages_actor_idempotency_idx
  on live_chat_messages (user_id, idempotency_key)
  where idempotency_key is not null;

create table live_room_control_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references live_rooms(id) on delete cascade,
  actor_user_id uuid not null references users(id),
  action text not null check (action in (
    'host_credentials_revealed',
    'creator_ended',
    'staff_suspended',
    'staff_resumed'
  )),
  state text not null default 'pending' check (state in ('pending', 'completed', 'failed')),
  idempotency_key text not null,
  request_hash text not null,
  reason text,
  provider_failure_kind text,
  provider_status_code integer,
  attempt_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key),
  check (char_length(idempotency_key) between 1 and 200),
  check (char_length(request_hash) = 64),
  check (reason is null or char_length(reason) between 1 and 1000),
  check (action not in ('staff_suspended', 'staff_resumed') or reason is not null),
  check (attempt_count >= 0),
  check (provider_status_code is null or provider_status_code between 100 and 599)
);

alter table live_room_control_actions enable row level security;

create index live_room_control_actions_room_created_at_idx
  on live_room_control_actions (room_id, created_at desc);

create index live_room_control_actions_pending_idx
  on live_room_control_actions (state, updated_at)
  where state in ('pending', 'failed');

create policy live_room_control_actions_select_creator_or_staff
  on live_room_control_actions for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_room_control_actions.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
  );

revoke all on table live_room_control_actions from anon, authenticated;
grant select on table live_room_control_actions to authenticated;
revoke all on table live_rooms from anon, authenticated;
revoke select (host_ingest_url, host_stream_key) on table live_rooms from anon, authenticated;
grant select on table live_chat_messages to authenticated;

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
      from live_rooms lr
      where lr.id = live_chat_messages.room_id
        and lr.state = 'live'
        and exists (
          select 1
          from media_safety_cases safety
          where safety.live_room_id = lr.id
            and safety.state = 'approved'
            and safety.provider_release_allowed is true
        )
        and not exists (
          select 1
          from blocks b
          where (b.blocker_user_id = (select private.current_app_user_id()) and b.blocked_user_id = lr.creator_user_id)
             or (b.blocker_user_id = lr.creator_user_id and b.blocked_user_id = (select private.current_app_user_id()))
        )
        and (
          lr.access_rule = 'public'
          or exists (
            select 1
            from subscriptions s
            where s.subscriber_user_id = (select private.current_app_user_id())
              and s.creator_user_id = lr.creator_user_id
              and s.scope = 'creator'
              and s.state in ('active', 'renewal_pending', 'grace_period')
              and (s.current_period_ends_at is null or s.current_period_ends_at > now())
          )
          or exists (
            select 1
            from live_passes lp
            where lp.room_id = lr.id
              and lp.user_id = (select private.current_app_user_id())
              and lp.state = 'active'
              and lp.starts_at <= now()
              and (lp.expires_at is null or lp.expires_at > now())
          )
        )
        and (
          not lr.members_only_chat
          or exists (
            select 1
            from subscriptions s
            where s.subscriber_user_id = (select private.current_app_user_id())
              and s.creator_user_id = lr.creator_user_id
              and s.scope = 'creator'
              and s.state in ('active', 'renewal_pending', 'grace_period')
              and (s.current_period_ends_at is null or s.current_period_ends_at > now())
          )
        )
    )
  );

comment on table live_room_control_actions is
  'Idempotent creator/staff live control receipts. Provider payloads and host credentials are never stored here.';
comment on column live_chat_messages.idempotency_key is
  'Actor-scoped API idempotency key; legacy rows remain null.';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_chat_messages'
     ) then
    alter publication supabase_realtime add table live_chat_messages;
  end if;
end $$;
