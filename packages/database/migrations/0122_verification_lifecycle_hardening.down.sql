drop index if exists verification_events_unmatched_reference_idx;
drop index if exists verification_records_subject_decision_idx;
drop index if exists verification_sessions_provider_external_user_idx;
drop index if exists verification_sessions_request_key_idx;

alter table verification_events
  drop column if exists identity_evidence,
  drop column if exists signature_hash,
  drop column if exists failure_reason_code,
  drop column if exists occurred_at,
  drop column if exists decision_status,
  drop column if exists correlation_id,
  drop column if exists provider_subject_reference,
  drop column if exists provider_reference;

alter table verification_records
  drop column if exists provider_event_at;

alter table verification_sessions
  drop column if exists provider_event_at,
  drop column if exists request_hash,
  drop column if exists request_key,
  drop column if exists launch_state,
  drop column if exists provider_external_user_id;
