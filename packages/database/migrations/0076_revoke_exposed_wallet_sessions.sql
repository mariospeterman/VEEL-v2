-- Sessions issued before wallet auth became cookie-only may have been readable by browser JavaScript.
-- Revoke them once so every active wallet session is created under the HttpOnly-only contract.
update wallet_auth_sessions
set revoked_at = coalesce(revoked_at, now())
where revoked_at is null;
