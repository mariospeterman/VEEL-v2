-- Discover hashtag foundation.
-- Fastify owns hashtag parsing and discover read models; RLS protects direct Data API reads.

create table hashtags (
  id uuid primary key,
  slug text not null unique,
  display_name text not null,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
  check (char_length(display_name) between 1 and 80),
  check (state in ('active', 'restricted', 'blocked'))
);

create table content_hashtags (
  content_item_id uuid not null references content_items(id) on delete cascade,
  hashtag_id uuid not null references hashtags(id) on delete cascade,
  source text not null default 'caption',
  created_at timestamptz not null default now(),
  primary key (content_item_id, hashtag_id),
  check (source in ('caption', 'admin'))
);

create index hashtags_state_slug_idx
  on hashtags (state, slug);

create index content_hashtags_hashtag_content_idx
  on content_hashtags (hashtag_id, content_item_id);

alter table hashtags enable row level security;
alter table content_hashtags enable row level security;

grant select on table hashtags to authenticated;
grant select on table content_hashtags to authenticated;

create policy hashtags_select_active_or_staff
  on hashtags for select to authenticated
  using (state in ('active', 'restricted') or private.is_staff_member());

create policy content_hashtags_select_visible_content_or_staff
  on content_hashtags for select to authenticated
  using (
    private.is_staff_member()
    or exists (
      select 1
      from content_items ci
      join hashtags h on h.id = content_hashtags.hashtag_id
      where ci.id = content_hashtags.content_item_id
        and ci.state = 'ready'
        and ci.visibility = 'public'
        and ci.moderation_state = 'approved'
        and h.state in ('active', 'restricted')
    )
  );
