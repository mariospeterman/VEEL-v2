-- Verification lifecycle hardening.
--
-- Keeps launch-session lifetime separate from verified evidence, reserves a
-- durable provider handoff before network I/O, and retains only normalized
-- authenticated webhook facts needed for ordering and reconciliation.

alter table verification_sessions
  add column provider_external_user_id text,
  add column launch_state text not null default 'ready'
    check (launch_state in ('reserved', 'ready', 'failed')),
  add column request_key text,
  add column request_hash text,
  add column provider_event_at timestamptz;

alter table verification_records
  add column provider_event_at timestamptz;

alter table verification_events
  add column provider_reference text,
  add column provider_subject_reference text,
  add column correlation_id text,
  add column decision_status text
    check (decision_status is null or decision_status in ('pending', 'valid', 'invalid', 'blocked')),
  add column occurred_at timestamptz,
  add column failure_reason_code text,
  add column signature_hash text,
  add column identity_evidence jsonb;

create unique index verification_sessions_request_key_idx
  on verification_sessions (subject_type, subject_id, purpose, request_key)
  where request_key is not null;

create index verification_sessions_provider_external_user_idx
  on verification_sessions (provider, provider_external_user_id, created_at desc)
  where provider_external_user_id is not null;

create index verification_records_subject_decision_idx
  on verification_records (subject_type, subject_id, purpose, provider_event_at desc, created_at desc);

create index verification_events_unmatched_reference_idx
  on verification_events (provider, provider_subject_reference, received_at)
  where processing_status in ('received', 'failed') and session_id is null;
