-- Bunny VOD status and playback projection.
-- Provider play data is normalized; raw provider payloads and API keys stay server-only.

alter table media_assets
  add column playback_url text,
  add column provider_playable boolean not null default false,
  add column ready_at timestamptz,
  add column provider_checked_at timestamptz;

create index media_assets_playback_ready_idx
  on media_assets (content_item_id, provider_playable, ready_at desc);
