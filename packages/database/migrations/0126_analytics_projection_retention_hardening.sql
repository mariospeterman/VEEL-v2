-- Preserve the exact media target used by playback analytics and make raw
-- telemetry retention both bounded and reconstruction-aware.

alter table platform_playback_sessions
  add column media_asset_id uuid references media_assets(id) on delete set null;

update platform_playback_sessions session
set media_asset_id = content.release_media_asset_id
from content_items content
where session.target_type = 'content'
  and content.id = session.target_id
  and content.release_media_asset_id is not null;

create index platform_playback_sessions_media_asset_idx
  on platform_playback_sessions (media_asset_id)
  where media_asset_id is not null;

create index analytics_profile_open_expiry_idx
  on analytics_profile_open_receipts (expires_at, actor_user_id, idempotency_key);

create index analytics_offer_impression_expiry_idx
  on analytics_offer_impression_receipts (expires_at, user_id, idempotency_key);

create index analytics_onboarding_expiry_idx
  on analytics_onboarding_journey_events (expires_at, journey_id, idempotency_key);

create table analytics_raw_retention_boundaries (
  source_key text primary key check (source_key in (
    'profile_open_receipts',
    'offer_impression_receipts',
    'onboarding_journey_events'
  )),
  unavailable_through date not null,
  rows_purged bigint not null default 0 check (rows_purged >= 0),
  last_purged_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table analytics_raw_retention_boundaries enable row level security;
revoke all on table analytics_raw_retention_boundaries from public, anon, authenticated;

comment on column platform_playback_sessions.media_asset_id is
  'Immutable snapshot of the exact content release asset used when a playback session starts; null for live-room sessions and legacy sessions without a release asset.';

comment on table analytics_raw_retention_boundaries is
  'Server-only reconstruction boundary advanced atomically with bounded raw telemetry deletion. Projection jobs overlapping unavailable raw dates fail closed instead of erasing retained aggregates.';
