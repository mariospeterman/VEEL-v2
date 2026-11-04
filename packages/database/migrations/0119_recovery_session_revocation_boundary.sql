-- Recovery JWTs are only an input to a short-lived exchange.  WeVid remains
-- authoritative through opaque app sessions, while Supabase owns recovery
-- session liveness in auth.sessions.

alter table users
  add column recovery_authentication_valid_after timestamptz not null default now();

alter table app_sessions
  add column provider_session_id uuid;

-- Existing recovery sessions stored a fabricated authenticated_at value and
-- cannot be upgraded safely.  Revoke them rather than carrying false freshness
-- across the cutover.
update app_sessions
set revoked_at = coalesce(revoked_at, now())
where authentication_method = 'supabase_recovery'
  and revoked_at is null;

alter table app_sessions
  add constraint app_sessions_provider_session_boundary_check check (
    (authentication_method = 'wallet' and provider_session_id is null)
    or
    (
      authentication_method = 'supabase_recovery'
      and (provider_session_id is not null or revoked_at is not null)
    )
  );

comment on column users.recovery_authentication_valid_after is
  'Per-user recovery revocation epoch. Supabase authentication used for exchange must be newer than this boundary.';

comment on column app_sessions.provider_session_id is
  'Signed Supabase session_id used for a recovery exchange; liveness is verified against auth.sessions before issuance.';
