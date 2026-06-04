-- Dating mode foundation.
-- Backend owns opt-in, swipes, mutual match creation, match state, and match conversations.

create table dating_profiles (
  user_id uuid primary key references users(id),
  enabled boolean not null default false,
  consent_version text,
  active_match_limit integer not null default 10,
  visible_on_media boolean not null default true,
  safety_state text not null default 'clear',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active_match_limit between 1 and 50),
  check (safety_state in ('clear', 'limited', 'blocked'))
);

create table dating_swipes (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  action text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  check (actor_user_id <> target_user_id),
  check (action in ('yes', 'not_interested')),
  unique (actor_user_id, idempotency_key)
);

create unique index dating_swipes_content_unique
  on dating_swipes (actor_user_id, target_user_id, content_item_id)
  where content_item_id is not null;

create unique index dating_swipes_profile_unique
  on dating_swipes (actor_user_id, target_user_id)
  where content_item_id is null;

create index dating_swipes_target_action_idx
  on dating_swipes (target_user_id, actor_user_id, action, created_at desc);

create table dating_matches (
  id uuid primary key,
  user_a_id uuid not null references users(id),
  user_b_id uuid not null references users(id),
  source_content_item_id uuid references content_items(id),
  conversation_id uuid unique references conversations(id),
  state text not null default 'active',
  archived_by_user_id uuid references users(id),
  stale_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id),
  check (state in ('active', 'stale', 'archived', 'blocked', 'reported', 'expired'))
);

create unique index dating_matches_pair_unique
  on dating_matches (user_a_id, user_b_id);

create index dating_matches_user_a_state_idx
  on dating_matches (user_a_id, state, created_at desc);

create index dating_matches_user_b_state_idx
  on dating_matches (user_b_id, state, created_at desc);

create index dating_matches_source_content_idx
  on dating_matches (source_content_item_id)
  where source_content_item_id is not null;

alter table dating_profiles enable row level security;
alter table dating_swipes enable row level security;
alter table dating_matches enable row level security;

create policy dating_profiles_select_self_or_staff
  on dating_profiles for select to authenticated
  using (user_id = private.current_app_user_id() or private.is_staff_member());

create policy dating_swipes_select_self_or_staff
  on dating_swipes for select to authenticated
  using (
    actor_user_id = private.current_app_user_id()
    or target_user_id = private.current_app_user_id()
    or private.is_staff_member()
  );

create policy dating_matches_select_member_or_staff
  on dating_matches for select to authenticated
  using (
    user_a_id = private.current_app_user_id()
    or user_b_id = private.current_app_user_id()
    or private.is_staff_member()
  );
