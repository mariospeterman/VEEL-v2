drop function if exists private.current_verification_attempt(text, uuid, text);
drop index if exists public.verification_records_session_attempt_metadata_idx;
drop index if exists public.verification_sessions_active_attempt_lookup_idx;
