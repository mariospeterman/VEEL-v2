-- Read-only authority and lookup support for durable age/identity attempts.
--
-- Existing normalized session states remain immutable:
--   reserved + created   => reserved (provider request has not started)
--   reserved + submitted => reconciling (provider request outcome is ambiguous)
--   ready                => ready (durable launch handoff attached)
-- Launch/reconciliation facts live on the existing reservation record metadata.

create index verification_sessions_active_attempt_lookup_idx
  on public.verification_sessions (
    subject_type,
    subject_id,
    purpose,
    updated_at desc,
    id desc
  )
  where launch_state in ('reserved', 'ready')
    and status in ('created', 'pending', 'submitted', 'needs_review');

create index verification_records_session_attempt_metadata_idx
  on public.verification_records ((metadata ->> 'sessionId'), created_at desc, id desc)
  where metadata ->> 'source' = 'verification_session_reservation';

create function private.current_verification_attempt(
  p_subject_type text,
  p_subject_id uuid,
  p_purpose text
)
returns table (
  session_id uuid,
  provider text,
  provider_reference text,
  subject_reference text,
  request_key text,
  request_hash text,
  provider_preference text,
  launch_state text,
  launch_url text,
  status text,
  expires_at timestamptz,
  reconciliation_reason text,
  reconciliation_attempts integer,
  last_reconciled_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    session.id,
    session.provider,
    coalesce(
      session.provider_session_id,
      session.provider_applicant_id,
      session.provider_inquiry_id,
      session.provider_transaction_id
    ),
    session.provider_external_user_id,
    session.request_key,
    session.request_hash,
    reservation.metadata ->> 'providerPreference',
    case
      when session.launch_state = 'reserved' and session.status = 'submitted'
        then 'reconciling'
      else session.launch_state
    end,
    reservation.metadata ->> 'launchUrl',
    session.status,
    session.expires_at,
    reservation.metadata ->> 'reconciliationReason',
    case
      when coalesce(reservation.metadata ->> 'reconciliationAttempts', '') ~ '^[0-9]+$'
        then (reservation.metadata ->> 'reconciliationAttempts')::integer
      else 0
    end,
    case
      when coalesce(reservation.metadata ->> 'lastReconciledAt', '') ~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
        then (reservation.metadata ->> 'lastReconciledAt')::timestamptz
      else null
    end
  from public.verification_sessions session
  left join lateral (
    select record.metadata
    from public.verification_records record
    where record.metadata ->> 'source' = 'verification_session_reservation'
      and record.metadata ->> 'sessionId' = session.id::text
    order by record.created_at desc, record.id desc
    limit 1
  ) reservation on true
  where session.subject_type = p_subject_type
    and session.subject_id = p_subject_id
    and session.purpose = p_purpose
    and session.launch_state in ('reserved', 'ready')
    and session.status in ('created', 'pending', 'submitted', 'needs_review')
    and (
      session.launch_state = 'reserved'
      or session.expires_at is null
      or session.expires_at > now()
    )
  order by session.updated_at desc, session.created_at desc, session.id desc
  limit 1
$$;

revoke all on function private.current_verification_attempt(text, uuid, text)
  from public, anon, authenticated;

comment on function private.current_verification_attempt(text, uuid, text) is
  'Current recoverable provider attempt. Callers must hold the matching subject/purpose advisory lock before creating another attempt.';
