-- Launch 05: direct-message request authority, durable message actions, and read-only realtime projections.
-- Fastify owns all mutations. Supabase Realtime receives only participant-filtered projection changes.

-- Imported WeVid Realtime JWTs carry an explicit server-only marker and use the canonical
-- user id as sub. Recovery-provider JWTs continue through the provider-identity mapping.
create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce((select auth.jwt() ->> 'wevid_session'), 'false') = 'true'
      then (
        select app_user.id
        from public.users app_user
        where app_user.id = (select auth.uid())
          and app_user.state = 'active'
        limit 1
      )
    else (
      select identity.user_id
      from public.user_provider_identities identity
      where identity.provider = 'supabase'
        and identity.provider_subject = (select auth.uid())::text
        and identity.status = 'active'
      limit 1
    )
  end
$$;

create or replace function private.has_protected_app_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users app_user
    join public.profiles profile on profile.user_id = app_user.id
    where app_user.id = (select private.current_app_user_id())
      and app_user.state = 'active'
      and nullif(btrim(profile.handle), '') is not null
      and nullif(btrim(profile.display_name), '') is not null
      and exists (
        select 1 from public.wallets wallet where wallet.user_id = app_user.id
      )
      and coalesce((
        select
          record.status = 'valid'
          and (record.expires_at is null or record.expires_at > now())
        from public.verification_records record
        where record.subject_type = 'user'
          and record.subject_id = app_user.id
          and record.purpose = 'age_access'
        order by record.created_at desc, record.id desc
        limit 1
      ), false)
  )
$$;

create or replace function private.is_current_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members member
    where member.conversation_id = target_conversation_id
      and member.user_id = (select private.current_app_user_id())
  )
$$;

-- The legacy schema did not enforce direct-pair shape. Refuse to guess or discard
-- message history during promotion; staging must repair malformed or duplicate pairs
-- explicitly before this migration is applied.
do $$
begin
  if exists (
    select 1
    from conversations c
    left join conversation_members cm on cm.conversation_id = c.id
    where c.type = 'direct'
    group by c.id
    having count(cm.user_id) <> 2
  ) then
    raise exception using
      errcode = 'check_violation',
      message = '0095 requires every legacy direct conversation to have exactly two members';
  end if;

  if exists (
    select 1
    from conversations c
    join lateral (
      select array_agg(cm.user_id order by cm.user_id) as member_ids
      from conversation_members cm
      where cm.conversation_id = c.id
    ) members on true
    where c.type = 'direct'
    group by members.member_ids[1], members.member_ids[2]
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = '0095 requires one legacy direct conversation per unordered user pair';
  end if;
end;
$$;

create table direct_message_requests (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  initiator_user_id uuid not null references users(id) on delete cascade,
  recipient_user_id uuid not null references users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'declined')),
  requester_message_count smallint not null default 0 check (requester_message_count between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  foreign key (conversation_id, initiator_user_id)
    references conversation_members (conversation_id, user_id) on delete cascade,
  foreign key (conversation_id, recipient_user_id)
    references conversation_members (conversation_id, user_id) on delete cascade,
  check (initiator_user_id <> recipient_user_id)
);

create unique index direct_message_requests_pair_unique
  on direct_message_requests (
    least(initiator_user_id, recipient_user_id),
    greatest(initiator_user_id, recipient_user_id)
  );

create index direct_message_requests_recipient_state_idx
  on direct_message_requests (recipient_user_id, state, updated_at desc);

create index direct_message_requests_initiator_state_idx
  on direct_message_requests (initiator_user_id, state, updated_at desc);

insert into direct_message_requests (
  conversation_id,
  initiator_user_id,
  recipient_user_id,
  state,
  created_at,
  updated_at,
  responded_at
)
select
  c.id,
  first_member.user_id,
  second_member.user_id,
  'accepted',
  c.created_at,
  c.updated_at,
  c.updated_at
from conversations c
join lateral (
  select cm.user_id
  from conversation_members cm
  where cm.conversation_id = c.id
  order by cm.created_at, cm.user_id
  limit 1
) first_member on true
join lateral (
  select cm.user_id
  from conversation_members cm
  where cm.conversation_id = c.id
    and cm.user_id <> first_member.user_id
  order by cm.created_at, cm.user_id
  limit 1
) second_member on true
where c.type = 'direct';

create table private.migration_0095_legacy_direct_requests (
  conversation_id uuid primary key references direct_message_requests(conversation_id) on delete cascade
);

insert into private.migration_0095_legacy_direct_requests (conversation_id)
select conversation_id from direct_message_requests;

create table message_action_receipts (
  actor_user_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  action text not null check (action in ('conversation.create', 'conversation.request.respond', 'conversation.read')),
  request_hash text not null,
  conversation_id uuid not null references conversations(id) on delete cascade,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key)
);

create index message_action_receipts_conversation_idx
  on message_action_receipts (conversation_id, created_at desc);

create table notification_action_receipts (
  actor_user_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  action text not null check (action in ('notification.read', 'notification.preferences.update')),
  request_hash text not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key)
);

alter table direct_message_requests enable row level security;
alter table message_action_receipts enable row level security;
alter table notification_action_receipts enable row level security;

grant select on table messages, conversation_members, direct_message_requests to authenticated;

drop policy if exists messages_select_conversation_member_or_staff on messages;
create policy messages_select_visible_participant
  on messages for select to authenticated
  using (
    delivery_state = 'visible'
    and (select private.has_protected_app_access())
    and (select private.is_current_conversation_member(conversation_id))
  );

drop policy if exists conversation_members_select_member_or_staff on conversation_members;
create policy conversation_members_select_participant
  on conversation_members for select to authenticated
  using (
    (select private.has_protected_app_access())
    and (select private.is_current_conversation_member(conversation_id))
  );

create policy direct_message_requests_select_participant
  on direct_message_requests for select to authenticated
  using (
    (select private.has_protected_app_access())
    and (
      initiator_user_id = (select private.current_app_user_id())
      or recipient_user_id = (select private.current_app_user_id())
    )
  );

drop policy if exists notifications_select_self_or_staff on notifications;
create policy notifications_select_self
  on notifications for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.has_protected_app_access())
  );

-- Projection writes stay behind Fastify's authorization, validation, audit, and idempotency boundary.
revoke insert, update, delete on table notifications from authenticated;
revoke insert, update, delete on table notification_preferences from authenticated;
revoke insert, update, delete on table notification_devices from authenticated;

drop policy if exists notifications_update_self_read_state on notifications;
drop policy if exists notification_preferences_insert_self on notification_preferences;
drop policy if exists notification_preferences_update_self_or_staff on notification_preferences;
drop policy if exists notification_devices_insert_self on notification_devices;
drop policy if exists notification_devices_update_self_or_staff on notification_devices;
drop policy if exists notification_devices_delete_self_or_staff on notification_devices;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'direct_message_requests'
    ) then
    alter publication supabase_realtime add table direct_message_requests;
  end if;
end;
$$;
