-- Canonical social graph and bounded feed projections.
-- Follow is deliberately independent from Mutuals, messaging, membership, and access.

create schema if not exists extensions;
alter extension pgcrypto set schema extensions;

create table user_follows (
  follower_user_id uuid not null references users(id) on delete cascade,
  followed_user_id uuid not null references users(id) on delete cascade,
  state text not null default 'active' check (state in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id),
  check (follower_user_id <> followed_user_id)
);

create table follow_action_receipts (
  actor_user_id uuid not null references users(id) on delete cascade,
  target_user_id uuid not null references users(id) on delete cascade,
  action text not null check (action in ('follow', 'unfollow')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key),
  check (actor_user_id <> target_user_id)
);

create table user_social_counts (
  user_id uuid primary key references users(id) on delete cascade,
  follower_count bigint not null default 0 check (follower_count >= 0),
  following_count bigint not null default 0 check (following_count >= 0),
  updated_at timestamptz not null default now()
);

insert into user_social_counts (user_id)
select id from users;

create table content_engagement_counters (
  content_item_id uuid primary key references content_items(id) on delete cascade,
  like_count bigint not null default 0 check (like_count >= 0),
  comment_count bigint not null default 0 check (comment_count >= 0),
  share_count bigint not null default 0 check (share_count >= 0),
  updated_at timestamptz not null default now()
);

insert into content_engagement_counters (
  content_item_id,
  like_count,
  comment_count,
  share_count
)
select
  content.id,
  coalesce(reaction.like_count, 0),
  coalesce(comment.comment_count, 0),
  coalesce(share.share_count, 0)
from content_items content
left join (
  select content_item_id, count(*) as like_count
  from content_reactions
  where reaction_key = 'like' and state = 'active'
  group by content_item_id
) reaction on reaction.content_item_id = content.id
left join (
  select content_item_id, count(*) as comment_count
  from comments
  where moderation_state = 'visible'
  group by content_item_id
) comment on comment.content_item_id = content.id
left join (
  select target_id, count(*) as share_count
  from share_records
  where target_type = 'content' and state = 'created'
  group by target_id
) share on share.target_id = content.id;

create table viewer_content_impressions (
  user_id uuid not null references users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  impression_count integer not null default 1 check (impression_count between 1 and 2147483647),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

create table feed_impression_receipts (
  user_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  content_item_id uuid not null references content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (user_id, idempotency_key)
);

create index user_follows_followed_active_idx
  on user_follows (followed_user_id, follower_user_id)
  where state = 'active';

create index user_follows_follower_active_idx
  on user_follows (follower_user_id, followed_user_id)
  where state = 'active';

create index user_follows_followed_user_fk_idx
  on user_follows (followed_user_id);

create index follow_action_receipts_target_user_fk_idx
  on follow_action_receipts (target_user_id, actor_user_id);

create index viewer_content_impressions_user_recent_idx
  on viewer_content_impressions (user_id, last_seen_at desc, content_item_id);

create index viewer_content_impressions_content_fk_idx
  on viewer_content_impressions (content_item_id, user_id);

create index feed_impression_receipts_content_fk_idx
  on feed_impression_receipts (content_item_id, user_id);

create index feed_impression_receipts_expiry_idx
  on feed_impression_receipts (expires_at, user_id, idempotency_key);

create index content_items_feed_compound_idx
  on content_items (created_at desc, id desc, creator_user_id)
  where state = 'ready'
    and publish_state = 'published'
    and moderation_state = 'approved'
    and visibility = 'public';

create or replace function private.ensure_user_social_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into user_social_counts (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger users_ensure_social_projection
after insert on users
for each row execute function private.ensure_user_social_projection();

create or replace function private.ensure_content_engagement_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into content_engagement_counters (content_item_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger content_items_ensure_engagement_projection
after insert on content_items
for each row execute function private.ensure_content_engagement_projection();

create or replace function private.apply_follow_count_delta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_active integer := case when tg_op <> 'INSERT' and old.state = 'active' then 1 else 0 end;
  new_active integer := case when tg_op <> 'DELETE' and new.state = 'active' then 1 else 0 end;
  delta integer := new_active - old_active;
  follower_id uuid := case when tg_op = 'DELETE' then old.follower_user_id else new.follower_user_id end;
  followed_id uuid := case when tg_op = 'DELETE' then old.followed_user_id else new.followed_user_id end;
begin
  if delta <> 0 then
    insert into user_social_counts (user_id, following_count)
    values (follower_id, greatest(delta, 0))
    on conflict (user_id) do update
    set following_count = greatest(0, user_social_counts.following_count + delta), updated_at = now();

    insert into user_social_counts (user_id, follower_count)
    values (followed_id, greatest(delta, 0))
    on conflict (user_id) do update
    set follower_count = greatest(0, user_social_counts.follower_count + delta), updated_at = now();
  end if;
  return coalesce(new, old);
end;
$$;

create trigger user_follows_apply_counts
after insert or update of state or delete on user_follows
for each row execute function private.apply_follow_count_delta();

create or replace function private.remove_blocked_follow_edges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update user_follows
  set state = 'inactive', updated_at = now()
  where state = 'active'
    and (
      (follower_user_id = new.blocker_user_id and followed_user_id = new.blocked_user_id)
      or (follower_user_id = new.blocked_user_id and followed_user_id = new.blocker_user_id)
    );
  return new;
end;
$$;

create trigger blocks_remove_follow_edges
after insert on blocks
for each row execute function private.remove_blocked_follow_edges();

-- Apply only the changed row's contribution. The counter-row upsert is atomic,
-- so concurrent reactions cannot overwrite one another with a stale recount.
create or replace function private.refresh_content_engagement_counter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  projection_content_id uuid;
  like_delta integer := 0;
  comment_delta integer := 0;
  share_delta integer := 0;
begin
  if tg_table_name = 'content_reactions' then
    projection_content_id := coalesce(new.content_item_id, old.content_item_id);
    if tg_op <> 'INSERT' and old.reaction_key = 'like' and old.state = 'active' then
      like_delta := like_delta - 1;
    end if;
    if tg_op <> 'DELETE' and new.reaction_key = 'like' and new.state = 'active' then
      like_delta := like_delta + 1;
    end if;
  elsif tg_table_name = 'comments' then
    projection_content_id := coalesce(new.content_item_id, old.content_item_id);
    if tg_op <> 'INSERT' and old.moderation_state = 'visible' then
      comment_delta := comment_delta - 1;
    end if;
    if tg_op <> 'DELETE' and new.moderation_state = 'visible' then
      comment_delta := comment_delta + 1;
    end if;
  else
    if coalesce(new.target_type, old.target_type) <> 'content' then
      return coalesce(new, old);
    end if;
    projection_content_id := coalesce(new.target_id, old.target_id);
    if tg_op <> 'INSERT' and old.target_type = 'content' and old.state = 'created' then
      share_delta := share_delta - 1;
    end if;
    if tg_op <> 'DELETE' and new.target_type = 'content' and new.state = 'created' then
      share_delta := share_delta + 1;
    end if;
  end if;

  insert into content_engagement_counters (
    content_item_id,
    like_count,
    comment_count,
    share_count,
    updated_at
  )
  select
    projection_content_id,
    greatest(like_delta, 0),
    greatest(comment_delta, 0),
    greatest(share_delta, 0),
    now()
  where exists (select 1 from content_items content where content.id = projection_content_id)
  on conflict (content_item_id) do update
  set
    like_count = greatest(0, content_engagement_counters.like_count + like_delta),
    comment_count = greatest(0, content_engagement_counters.comment_count + comment_delta),
    share_count = greatest(0, content_engagement_counters.share_count + share_delta),
    updated_at = excluded.updated_at;

  return coalesce(new, old);
end;
$$;

create trigger content_reactions_refresh_counter
after insert or update of state or delete on content_reactions
for each row execute function private.refresh_content_engagement_counter();

create trigger comments_refresh_counter
after insert or update of moderation_state or delete on comments
for each row execute function private.refresh_content_engagement_counter();

create trigger share_records_refresh_counter
after insert or update of state or delete on share_records
for each row execute function private.refresh_content_engagement_counter();

alter table user_follows enable row level security;
alter table follow_action_receipts enable row level security;
alter table user_social_counts enable row level security;
alter table content_engagement_counters enable row level security;
alter table viewer_content_impressions enable row level security;
alter table feed_impression_receipts enable row level security;

grant select on table user_follows to authenticated;
grant select on table follow_action_receipts to authenticated;
grant select on table user_social_counts to authenticated;
grant select on table content_engagement_counters to authenticated;
grant select on table viewer_content_impressions to authenticated;
grant select on table feed_impression_receipts to authenticated;

create policy user_follows_select_participant_or_staff
  on user_follows for select to authenticated
  using (
    follower_user_id = (select private.current_app_user_id())
    or followed_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy follow_action_receipts_select_actor_or_staff
  on follow_action_receipts for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy user_social_counts_select_authenticated
  on user_social_counts for select to authenticated using (true);

create policy content_engagement_counters_select_authenticated
  on content_engagement_counters for select to authenticated using (true);

create policy viewer_content_impressions_select_self_or_staff
  on viewer_content_impressions for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy feed_impression_receipts_select_self_or_staff
  on feed_impression_receipts for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

comment on table user_follows is
  'Canonical follow graph. It conveys no Mutuals, messaging, access, membership, or ranking guarantee.';
comment on table content_engagement_counters is
  'Bounded feed/read projection; canonical engagement rows remain mutation truth.';
comment on table viewer_content_impressions is
  'Viewer-owned feed signal used only for deterministic recommendation de-prioritisation.';
comment on table feed_impression_receipts is
  'Seven-day viewer-scoped idempotency receipts; keys cannot be replayed for a different content item inside the retry window.';
