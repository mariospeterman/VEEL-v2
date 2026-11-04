-- Bounded, short-lived feed ranking snapshots.
-- These rows are derived navigation state only. They are not content, access, payment,
-- entitlement, or analytics authority, and money is never a ranking input.

create table feed_ranking_sessions (
  id uuid primary key default gen_random_uuid(),
  viewer_user_id uuid not null references users(id) on delete cascade,
  mode text not null check (mode in ('recommended', 'following')),
  surface text not null check (surface in ('home', 'bits', 'moments')),
  as_of timestamptz not null,
  ranked_content_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (cardinality(ranked_content_ids) between 0 and 512),
  check (array_position(ranked_content_ids, null::uuid) is null),
  check (expires_at > as_of),
  check (expires_at <= as_of + interval '30 minutes')
);

create index feed_ranking_sessions_expiry_idx
  on feed_ranking_sessions (expires_at, id);

create index feed_ranking_sessions_viewer_idx
  on feed_ranking_sessions (viewer_user_id, created_at desc);

create index content_items_feed_session_candidate_idx
  on content_items (distribution_mode, created_at desc, id desc)
  include (creator_user_id, media_type, expires_at)
  where state = 'ready'
    and publish_state = 'published'
    and moderation_state = 'approved';

alter table feed_ranking_sessions enable row level security;
revoke all on table feed_ranking_sessions from public, anon, authenticated;

comment on table feed_ranking_sessions is
  'Server-only, short-lived, bounded feed ordering snapshots. Canonical content eligibility and access are re-evaluated when each page is delivered; engagement counters remain independent live projections.';

