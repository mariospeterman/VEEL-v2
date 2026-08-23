-- Convergence 05: scoped Broadcast invalidations, consent-safe messages, and fail-closed live safety.
-- Realtime is transport only. Fastify, canonical domain tables, and backend release predicates remain truth.

alter table conversation_members
  add column muted_at timestamptz;

alter table direct_message_requests
  drop constraint direct_message_requests_requester_message_count_check;

-- Preserve historical introductions while enforcing the launch policy for all future writes.
update direct_message_requests
set requester_message_count = 1
where requester_message_count > 1;

alter table direct_message_requests
  add constraint direct_message_requests_requester_message_count_check
  check (requester_message_count between 0 and 1);

alter table message_action_receipts
  drop constraint message_action_receipts_action_check,
  add constraint message_action_receipts_action_check check (action in (
    'conversation.create', 'conversation.request.respond', 'conversation.read', 'conversation.mute',
    'media_offer.create', 'media_offer.update', 'creator_request.create', 'creator_request.update'
  ));

alter table messages
  add column reply_to_message_id uuid references messages(id) on delete set null,
  add column shared_content_item_id uuid references content_items(id) on delete set null;

create index messages_reply_idx
  on messages (reply_to_message_id)
  where reply_to_message_id is not null;

create index messages_shared_content_idx
  on messages (shared_content_item_id)
  where shared_content_item_id is not null;

create table message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('like', 'love', 'laugh', 'support')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction_key)
);

create index message_reactions_user_idx
  on message_reactions (user_id, created_at desc);

create table message_attachments (
  message_id uuid not null references messages(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete restrict,
  content_revision bigint not null check (content_revision > 0),
  position smallint not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (message_id, content_item_id),
  unique (message_id, position)
);

create index message_attachments_content_idx
  on message_attachments (content_item_id, content_revision);

create table creator_media_offers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  creator_user_id uuid not null references users(id) on delete cascade,
  buyer_user_id uuid not null references users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete restrict,
  content_revision bigint not null check (content_revision > 0),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) between 1 and 1000),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency text not null check (currency in ('SOL', 'USDC')),
  state text not null default 'offered' check (state in (
    'offered', 'accepted', 'declined', 'withdrawn', 'expired', 'purchased', 'remediation'
  )),
  payment_intent_id uuid unique references payment_intents(id) on delete set null,
  idempotency_key text not null,
  request_hash text not null check (char_length(request_hash) = 64),
  expires_at timestamptz not null,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_user_id, idempotency_key),
  foreign key (conversation_id, creator_user_id)
    references conversation_members(conversation_id, user_id) on delete cascade,
  foreign key (conversation_id, buyer_user_id)
    references conversation_members(conversation_id, user_id) on delete cascade,
  check (creator_user_id <> buyer_user_id),
  check ((state = 'purchased') = (purchased_at is not null))
);

create index creator_media_offers_conversation_idx
  on creator_media_offers (conversation_id, created_at desc);

create table structured_creator_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  requester_user_id uuid not null references users(id) on delete cascade,
  creator_user_id uuid not null references users(id) on delete cascade,
  deliverable text not null check (char_length(deliverable) between 3 and 1000),
  permitted_category text not null check (permitted_category in (
    'photo', 'video', 'audio', 'written', 'other_safe'
  )),
  proposed_amount_minor bigint check (
    proposed_amount_minor is null or proposed_amount_minor between 1 and 9007199254740991
  ),
  agreed_amount_minor bigint check (
    agreed_amount_minor is null or agreed_amount_minor between 1 and 9007199254740991
  ),
  currency text not null check (currency in ('SOL', 'USDC')),
  expected_delivery_days smallint check (expected_delivery_days between 1 and 90),
  clarification_rule text not null check (char_length(clarification_rule) between 3 and 500),
  cancellation_rule text not null check (char_length(cancellation_rule) between 3 and 500),
  state text not null default 'proposed' check (state in (
    'proposed', 'terms_proposed', 'accepted', 'declined', 'payment_pending',
    'active', 'delivered', 'remediation', 'completed', 'cancelled', 'expired'
  )),
  payment_intent_id uuid unique references payment_intents(id) on delete set null,
  idempotency_key text not null,
  request_hash text not null check (char_length(request_hash) = 64),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  activated_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_user_id, idempotency_key),
  foreign key (conversation_id, requester_user_id)
    references conversation_members(conversation_id, user_id) on delete cascade,
  foreign key (conversation_id, creator_user_id)
    references conversation_members(conversation_id, user_id) on delete cascade,
  check (requester_user_id <> creator_user_id),
  check (state not in ('accepted', 'payment_pending', 'active', 'delivered', 'remediation', 'completed') or agreed_amount_minor is not null)
);

create index structured_creator_requests_conversation_idx
  on structured_creator_requests (conversation_id, created_at desc);

create table live_safety_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references live_rooms(id) on delete cascade,
  media_safety_case_id uuid not null unique references media_safety_cases(id) on delete cascade,
  provider text not null default 'livepeer' check (provider = 'livepeer'),
  moderation_target_reference text,
  state text not null default 'monitoring_pending' check (state in (
    'monitoring_pending', 'target_connected', 'monitoring', 'held', 'suspended', 'ended'
  )),
  acknowledgement_event_id text,
  acknowledged_at timestamptz,
  last_heartbeat_at timestamptz,
  heartbeat_expires_at timestamptz,
  next_check_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  hold_reason_code text,
  held_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((acknowledgement_event_id is null) = (acknowledged_at is null)),
  check ((last_heartbeat_at is null) = (heartbeat_expires_at is null)),
  check ((lease_token is null) = (lease_expires_at is null)),
  check ((state in ('held', 'suspended')) = (held_at is not null)),
  check (hold_reason_code is null or char_length(hold_reason_code) between 1 and 120)
);

create index live_safety_sessions_due_idx
  on live_safety_sessions (next_check_at, created_at)
  where state in ('monitoring_pending', 'target_connected', 'monitoring');

create table live_safety_monitoring_events (
  id uuid primary key default gen_random_uuid(),
  live_safety_session_id uuid not null references live_safety_sessions(id) on delete cascade,
  provider text not null check (provider in ('livepeer', 'moderation_provider', 'internal')),
  provider_event_id text not null,
  event_kind text not null check (event_kind in (
    'target_connected', 'heartbeat', 'target_disconnected', 'adverse_signal', 'provider_inconsistent'
  )),
  normalized_signal text not null check (normalized_signal in (
    'healthy', 'known_illegal_hash', 'apparent_minor_sexual_context',
    'severe_sexual_violence', 'severe_graphic_violence', 'disconnected', 'inconsistent'
  )),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  signature_hash text check (signature_hash is null or signature_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  applied_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index live_safety_monitoring_events_session_idx
  on live_safety_monitoring_events (live_safety_session_id, observed_at desc);

create table live_safety_provider_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references live_rooms(id) on delete cascade,
  action text not null check (action = 'suspend'),
  reason_code text not null check (char_length(reason_code) between 1 and 120),
  state text not null default 'queued' check (state in ('queued', 'processing', 'retry', 'completed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_expires_at is null))
);

create unique index live_safety_provider_actions_open_uidx
  on live_safety_provider_actions (room_id, action)
  where state in ('queued', 'processing', 'retry');

create index live_safety_provider_actions_due_idx
  on live_safety_provider_actions (next_attempt_at, created_at)
  where state in ('queued', 'processing', 'retry');

alter table message_reactions enable row level security;
alter table message_attachments enable row level security;
alter table creator_media_offers enable row level security;
alter table structured_creator_requests enable row level security;
alter table live_safety_sessions enable row level security;
alter table live_safety_monitoring_events enable row level security;
alter table live_safety_provider_actions enable row level security;

grant select on table message_reactions, message_attachments, creator_media_offers, structured_creator_requests to authenticated;
revoke all on table live_safety_sessions, live_safety_monitoring_events, live_safety_provider_actions from anon, authenticated;

create policy message_reactions_select_participant
  on message_reactions for select to authenticated
  using (
    (select private.has_protected_app_access())
    and exists (
      select 1
      from messages message
      where message.id = message_reactions.message_id
        and message.delivery_state = 'visible'
        and (select private.is_current_conversation_member(message.conversation_id))
    )
  );

create policy message_attachments_select_participant
  on message_attachments for select to authenticated
  using (
    (select private.has_protected_app_access())
    and exists (
      select 1
      from messages message
      where message.id = message_attachments.message_id
        and message.delivery_state = 'visible'
        and (select private.is_current_conversation_member(message.conversation_id))
    )
  );

create policy creator_media_offers_select_participant
  on creator_media_offers for select to authenticated
  using (
    (select private.has_protected_app_access())
    and (select private.is_current_conversation_member(conversation_id))
  );

create policy structured_creator_requests_select_participant
  on structured_creator_requests for select to authenticated
  using (
    (select private.has_protected_app_access())
    and (select private.is_current_conversation_member(conversation_id))
  );

-- Existing creator-attestation-only live approvals are unsafe. Promotion revokes public release;
-- a signed target acknowledgement and fresh heartbeat must establish the new predicate.
update media_safety_cases safety
set
  state = 'quarantined',
  reason_code = 'live_monitoring_pending',
  provider_release_allowed = false,
  decided_at = null,
  updated_at = now()
where safety.live_room_id is not null
  and safety.state <> 'superseded';

insert into live_safety_sessions (
  room_id,
  media_safety_case_id,
  state,
  next_check_at
)
select
  room.id,
  safety.id,
  case when room.state in ('ended', 'replay_ready') then 'ended' else 'monitoring_pending' end,
  now()
from live_rooms room
join media_safety_cases safety
  on safety.live_room_id = room.id
  and safety.state <> 'superseded'
on conflict (room_id) do nothing;

create or replace function private.live_safety_release_ready(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce((
    select
      room.state = 'live'
      and session.state = 'monitoring'
      and session.acknowledged_at is not null
      and session.last_heartbeat_at is not null
      and session.heartbeat_expires_at > now()
      and session.held_at is null
    from live_rooms room
    join media_safety_cases safety
      on safety.live_room_id = room.id
      and safety.state <> 'superseded'
    join live_safety_sessions session
      on session.room_id = room.id
      and session.media_safety_case_id = safety.id
    where room.id = target_room_id
  ), false);
$$;

create or replace function private.enforce_live_safety_release()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.live_room_id is not null
     and new.provider_release_allowed is true
     and not private.live_safety_release_ready(new.live_room_id) then
    raise exception using errcode = 'P0001', message = 'live_safety_release_not_ready';
  end if;
  return new;
end;
$$;

create trigger media_safety_cases_live_release_guard
before insert or update of state, provider_release_allowed on media_safety_cases
for each row execute function private.enforce_live_safety_release();

create table realtime_topic_versions (
  topic text primary key check (topic ~ '^(account|conversation|live):[0-9a-f-]{36}$'),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);

create table realtime_connection_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  topic_kind text not null check (topic_kind in ('account', 'conversation', 'live')),
  state text not null check (state in ('connected', 'reconnecting', 'failed', 'disconnected')),
  reason_code text not null check (reason_code in (
    'subscribed', 'channel_error', 'timed_out', 'closed', 'token_unavailable', 'cleanup'
  )),
  attempt smallint not null default 0 check (attempt between 0 and 10),
  occurred_at timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now()
);

create unique index realtime_connection_events_actor_idempotency_uidx
  on realtime_connection_events (user_id, idempotency_key);

create index realtime_connection_events_health_idx
  on realtime_connection_events (state, created_at desc);

alter table realtime_topic_versions enable row level security;
alter table realtime_connection_events enable row level security;
revoke all on table realtime_topic_versions, realtime_connection_events from anon, authenticated;

create or replace function private.realtime_conversation_access(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    (select private.has_protected_app_access())
    and exists (
      select 1
      from conversation_members own_member
      join conversation_members other_member
        on other_member.conversation_id = own_member.conversation_id
        and other_member.user_id <> own_member.user_id
      join conversations conversation on conversation.id = own_member.conversation_id
      left join direct_message_requests request on request.conversation_id = conversation.id
      where own_member.conversation_id = target_conversation_id
        and own_member.user_id = (select private.current_app_user_id())
        and conversation.state = 'active'
        and coalesce(request.state, 'accepted') <> 'declined'
        and not exists (
          select 1 from blocks block
          where (block.blocker_user_id = own_member.user_id and block.blocked_user_id = other_member.user_id)
             or (block.blocker_user_id = other_member.user_id and block.blocked_user_id = own_member.user_id)
        )
    );
$$;

create or replace function private.realtime_live_access(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    (select private.has_protected_app_access())
    and exists (
      select 1
      from live_rooms room
      where room.id = target_room_id
        and private.live_safety_release_ready(room.id)
        and (
          room.creator_user_id = (select private.current_app_user_id())
          or room.access_rule = 'public'
          or exists (
            select 1 from subscriptions subscription
            where subscription.subscriber_user_id = (select private.current_app_user_id())
              and subscription.creator_user_id = room.creator_user_id
              and subscription.scope = 'creator'
              and subscription.state in ('active', 'renewal_pending', 'grace_period')
              and (subscription.current_period_ends_at is null or subscription.current_period_ends_at > now())
          )
          or exists (
            select 1 from live_passes pass
            where pass.room_id = room.id
              and pass.user_id = (select private.current_app_user_id())
              and pass.state = 'active'
              and pass.starts_at <= now()
              and (pass.expires_at is null or pass.expires_at > now())
          )
        )
    );
$$;

create or replace function private.realtime_topic_can_receive(target_topic text, target_extension text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  resource_id uuid;
begin
  if target_extension not in ('broadcast', 'presence') then return false; end if;
  if target_topic = 'account:' || (select private.current_app_user_id())::text then
    return (select private.has_protected_app_access());
  end if;
  if target_topic !~ '^(conversation|live):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  resource_id := split_part(target_topic, ':', 2)::uuid;
  if target_topic like 'conversation:%' then
    return private.realtime_conversation_access(resource_id);
  end if;
  return private.realtime_live_access(resource_id);
end;
$$;

create or replace function private.realtime_topic_can_send(target_topic text, target_extension text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  resource_id uuid;
begin
  if target_extension not in ('broadcast', 'presence')
     or target_topic !~ '^(conversation|live):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  resource_id := split_part(target_topic, ':', 2)::uuid;
  if target_topic like 'conversation:%' then
    return private.realtime_conversation_access(resource_id)
      and exists (
        select 1 from direct_message_requests request
        where request.conversation_id = resource_id and request.state = 'accepted'
      );
  end if;
  return private.realtime_live_access(resource_id);
end;
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists wevid_scoped_receive on realtime.messages';
    execute 'drop policy if exists wevid_scoped_send on realtime.messages';
    execute $policy$
      create policy wevid_scoped_receive
      on realtime.messages for select to authenticated
      using (private.realtime_topic_can_receive(realtime.topic(), realtime.messages.extension))
    $policy$;
    execute $policy$
      create policy wevid_scoped_send
      on realtime.messages for insert to authenticated
      with check (private.realtime_topic_can_send(realtime.topic(), realtime.messages.extension))
    $policy$;
  end if;
end;
$$;

create or replace function private.emit_realtime_invalidation(
  target_topic text,
  event_key text,
  resource_kind text,
  resource_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  next_version bigint;
  event_payload jsonb;
begin
  insert into realtime_topic_versions (topic, version)
  values (target_topic, 1)
  on conflict (topic) do update
    set version = realtime_topic_versions.version + 1,
        updated_at = now()
  returning version into next_version;

  event_payload := jsonb_build_object(
    'event', event_key,
    'resourceKind', resource_kind,
    'resourceId', resource_id,
    'version', next_version
  );

  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, true)'
      using event_payload, 'projection_changed', target_topic;
  end if;
end;
$$;

create or replace function private.broadcast_account_projection_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  target_user_id uuid := coalesce(new.user_id, old.user_id);
  target_id uuid := coalesce(new.id, old.id);
begin
  perform private.emit_realtime_invalidation(
    'account:' || target_user_id::text,
    lower(tg_op),
    tg_table_name,
    target_id
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.broadcast_conversation_projection_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  row_data jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  target_conversation_id uuid;
  target_id uuid;
  member record;
begin
  if tg_table_name in ('message_reactions', 'message_attachments') then
    select conversation_id into target_conversation_id
    from messages
    where id = (row_data ->> 'message_id')::uuid;
  else
    target_conversation_id := (row_data ->> 'conversation_id')::uuid;
  end if;
  if target_conversation_id is null then return coalesce(new, old); end if;
  target_id := coalesce(
    nullif(row_data ->> 'id', '')::uuid,
    nullif(row_data ->> 'message_id', '')::uuid,
    target_conversation_id
  );
  perform private.emit_realtime_invalidation(
    'conversation:' || target_conversation_id::text,
    lower(tg_op),
    tg_table_name,
    target_id
  );
  for member in select user_id from conversation_members where conversation_id = target_conversation_id loop
    perform private.emit_realtime_invalidation(
      'account:' || member.user_id::text,
      'conversation_changed',
      'conversation',
      target_conversation_id
    );
  end loop;
  return coalesce(new, old);
end;
$$;

create or replace function private.broadcast_live_projection_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  row_data jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  target_room_id uuid := coalesce(
    nullif(row_data ->> 'room_id', '')::uuid,
    nullif(row_data ->> 'id', '')::uuid
  );
  target_id uuid := coalesce(nullif(row_data ->> 'id', '')::uuid, target_room_id);
  owner_user_id uuid;
begin
  select creator_user_id into owner_user_id from live_rooms where id = target_room_id;
  perform private.emit_realtime_invalidation(
    'live:' || target_room_id::text,
    lower(tg_op),
    tg_table_name,
    target_id
  );
  if owner_user_id is not null then
    perform private.emit_realtime_invalidation(
      'account:' || owner_user_id::text,
      'live_changed',
      'live_room',
      target_room_id
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger notifications_broadcast_invalidation
after insert or update or delete on notifications
for each row execute function private.broadcast_account_projection_change();

create trigger messages_broadcast_invalidation
after insert or update or delete on messages
for each row execute function private.broadcast_conversation_projection_change();

create trigger conversation_members_broadcast_invalidation
after insert or update or delete on conversation_members
for each row execute function private.broadcast_conversation_projection_change();

create trigger direct_message_requests_broadcast_invalidation
after insert or update or delete on direct_message_requests
for each row execute function private.broadcast_conversation_projection_change();

create trigger message_reactions_broadcast_invalidation
after insert or update or delete on message_reactions
for each row execute function private.broadcast_conversation_projection_change();

create trigger message_attachments_broadcast_invalidation
after insert or update or delete on message_attachments
for each row execute function private.broadcast_conversation_projection_change();

create trigger creator_media_offers_broadcast_invalidation
after insert or update or delete on creator_media_offers
for each row execute function private.broadcast_conversation_projection_change();

create trigger structured_creator_requests_broadcast_invalidation
after insert or update or delete on structured_creator_requests
for each row execute function private.broadcast_conversation_projection_change();

create trigger live_rooms_broadcast_invalidation
after insert or update or delete on live_rooms
for each row execute function private.broadcast_live_projection_change();

create trigger live_chat_messages_broadcast_invalidation
after insert or update or delete on live_chat_messages
for each row execute function private.broadcast_live_projection_change();

create trigger live_safety_sessions_broadcast_invalidation
after insert or update or delete on live_safety_sessions
for each row execute function private.broadcast_live_projection_change();

-- Full private rows no longer use logical-replication fan-out. Minimal private Broadcast
-- invalidations above replace these publications when the Supabase publication is present.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime drop table notifications;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime drop table messages;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
      alter publication supabase_realtime drop table conversation_members;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_message_requests') then
      alter publication supabase_realtime drop table direct_message_requests;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_chat_messages') then
      alter publication supabase_realtime drop table live_chat_messages;
    end if;
  end if;
end;
$$;

comment on table realtime_topic_versions is
  'Monotonic invalidation versions only. Canonical APIs recover reconnect gaps.';
comment on table live_safety_sessions is
  'Backend-owned continuous monitoring predicate; creator attestation alone never releases viewers.';
comment on table structured_creator_requests is
  'Two-phase creator consent before any payment intent or delivery workspace activation.';
comment on column creator_media_offers.content_revision is
  'Approved content revision presented when the creator made the offer; payment fails closed if it changes.';
