-- Bind public-media allowance reservations to the short-lived playback
-- capabilities that the API is allowed to issue. Browser heartbeats remain
-- useful analytics evidence but are no longer allowance-debit authority.

alter table platform_playback_sessions
  add column allowance_reserved_seconds integer not null default 0
    check (allowance_reserved_seconds between 0 and 900),
  add column resource_lease_expires_at timestamptz;

alter table platform_playback_sessions
  add constraint platform_playback_sessions_resource_lease_check
    check (
      (allowance_reserved_seconds = 0 and resource_lease_expires_at is null)
      or
      (allowance_reserved_seconds > 0 and resource_lease_expires_at is not null)
    );

create index platform_playback_sessions_active_resource_lease_idx
  on platform_playback_sessions (user_id, target_type, target_id, resource_lease_expires_at desc)
  where state = 'active' and allowance_reserved_seconds > 0;

comment on column platform_playback_sessions.allowance_reserved_seconds is
  'Public-media allowance atomically reserved by the server before issuing the matching bounded provider capability; zero for unlimited and pre-0131 sessions.';

comment on column platform_playback_sessions.resource_lease_expires_at is
  'Upper bound for the matching Bunny or Livepeer viewer capability. No signed public-media resource may outlive this timestamp.';
