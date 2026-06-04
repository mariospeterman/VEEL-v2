drop index if exists media_assets_playback_ready_idx;
alter table media_assets
  drop column if exists provider_checked_at,
  drop column if exists ready_at,
  drop column if exists provider_playable,
  drop column if exists playback_url;
