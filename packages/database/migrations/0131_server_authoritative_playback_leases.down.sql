drop index if exists platform_playback_sessions_active_resource_lease_idx;

alter table platform_playback_sessions
  drop constraint if exists platform_playback_sessions_resource_lease_check,
  drop column if exists resource_lease_expires_at,
  drop column if exists allowance_reserved_seconds;
