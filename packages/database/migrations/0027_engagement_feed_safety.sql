-- Engagement, feed controls, reports, and blocks.
-- Fastify owns mutations; Supabase RLS protects direct reads/realtime projections.

create table viewer_feed_preferences (
  user_id uuid primary key references users(id),
  default_feed_mode text not null default 'recommended'
    check (default_feed_mode in ('recommended', 'following', 'nsfw', 'sfw')),
  nsfw_preference text not null default 'recommended'
    check (nsfw_preference in ('recommended', 'nsfw', 'sfw')),
  updated_at timestamptz not null default now()
);

create table viewer_hidden_creators (
  user_id uuid not null references users(id),
  creator_user_id uuid not null references users(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_user_id),
  unique (user_id, idempotency_key),
  check (user_id <> creator_user_id)
);

create table viewer_hidden_topics (
  user_id uuid not null references users(id),
  topic text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, topic),
  unique (user_id, idempotency_key),
  check (length(topic) between 1 and 80)
);

create table content_reactions (
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  reaction_key text not null default 'like'
    check (reaction_key = 'like'),
  state text not null default 'active'
    check (state in ('active', 'inactive')),
  last_idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_item_id, reaction_key),
  unique (user_id, last_idempotency_key)
);

create table content_saves (
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  state text not null default 'active'
    check (state in ('active', 'inactive')),
  last_idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_item_id),
  unique (user_id, last_idempotency_key)
);

create table engagement_action_receipts (
  actor_user_id uuid not null references users(id),
  action text not null
    check (action in ('content.like', 'content.save')),
  target_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, action, idempotency_key)
);

create table comments (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  user_id uuid not null references users(id),
  parent_comment_id uuid references comments(id),
  body text not null check (length(body) between 1 and 2000),
  moderation_state text not null default 'visible'
    check (moderation_state in ('visible', 'pending_review', 'hidden', 'removed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table share_records (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_type text not null
    check (target_type in ('content', 'profile', 'event')),
  target_id uuid not null,
  mode text not null
    check (mode in ('internal_message', 'external_referral_link', 'copy_link')),
  destination text,
  url text,
  state text not null default 'created'
    check (state in ('created', 'blocked')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create table reports (
  id uuid primary key,
  reporter_user_id uuid not null references users(id),
  subject_type text not null
    check (subject_type in ('content', 'user', 'message', 'live_room', 'event')),
  subject_id uuid not null,
  reason text not null check (length(reason) between 3 and 500),
  queue text not null
    check (queue in ('content', 'user', 'message', 'live', 'event', 'general')),
  state text not null default 'submitted'
    check (state in ('submitted', 'queued', 'reviewing', 'resolved', 'dismissed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (reporter_user_id, idempotency_key)
);

create table blocks (
  blocker_user_id uuid not null references users(id),
  blocked_user_id uuid not null references users(id),
  reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  unique (blocker_user_id, idempotency_key),
  check (blocker_user_id <> blocked_user_id)
);

create index viewer_hidden_creators_creator_idx
  on viewer_hidden_creators (creator_user_id);

create index content_reactions_content_active_idx
  on content_reactions (content_item_id)
  where state = 'active';

create index content_saves_content_active_idx
  on content_saves (content_item_id)
  where state = 'active';

create index comments_content_created_at_idx
  on comments (content_item_id, created_at desc)
  where moderation_state = 'visible';

create index comments_user_created_at_idx
  on comments (user_id, created_at desc);

create index comments_parent_comment_id_idx
  on comments (parent_comment_id)
  where parent_comment_id is not null;

create index share_records_target_created_at_idx
  on share_records (target_type, target_id, created_at desc);

create index share_records_actor_created_at_idx
  on share_records (actor_user_id, created_at desc);

create index reports_queue_state_created_at_idx
  on reports (queue, state, created_at desc);

create index reports_subject_idx
  on reports (subject_type, subject_id);

create index blocks_blocked_user_id_idx
  on blocks (blocked_user_id);

alter table viewer_feed_preferences enable row level security;
alter table viewer_hidden_creators enable row level security;
alter table viewer_hidden_topics enable row level security;
alter table content_reactions enable row level security;
alter table content_saves enable row level security;
alter table engagement_action_receipts enable row level security;
alter table comments enable row level security;
alter table share_records enable row level security;
alter table reports enable row level security;
alter table blocks enable row level security;

grant select on table viewer_feed_preferences to authenticated;
grant select on table viewer_hidden_creators to authenticated;
grant select on table viewer_hidden_topics to authenticated;
grant select on table content_reactions to authenticated;
grant select on table content_saves to authenticated;
grant select on table engagement_action_receipts to authenticated;
grant select on table comments to authenticated;
grant select on table share_records to authenticated;
grant select on table reports to authenticated;
grant select on table blocks to authenticated;

create policy viewer_feed_preferences_select_self_or_staff
  on viewer_feed_preferences for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy viewer_hidden_creators_select_self_or_staff
  on viewer_hidden_creators for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy viewer_hidden_topics_select_self_or_staff
  on viewer_hidden_topics for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy content_reactions_select_self_or_staff
  on content_reactions for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy content_saves_select_self_or_staff
  on content_saves for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy engagement_action_receipts_select_self_or_staff
  on engagement_action_receipts for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy comments_select_visible_author_creator_or_staff
  on comments for select to authenticated
  using (
    moderation_state = 'visible'
    or user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from content_items ci
      where ci.id = comments.content_item_id
        and ci.creator_user_id = (select private.current_app_user_id())
    )
  );

create policy share_records_select_actor_or_staff
  on share_records for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy reports_select_reporter_or_staff
  on reports for select to authenticated
  using (reporter_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy blocks_select_blocker_or_staff
  on blocks for select to authenticated
  using (blocker_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
