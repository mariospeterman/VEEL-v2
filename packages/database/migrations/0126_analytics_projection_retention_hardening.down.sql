drop table if exists analytics_raw_retention_boundaries;

drop index if exists analytics_onboarding_expiry_idx;
drop index if exists analytics_offer_impression_expiry_idx;
drop index if exists analytics_profile_open_expiry_idx;
drop index if exists platform_playback_sessions_media_asset_idx;

alter table platform_playback_sessions
  drop column if exists media_asset_id;
