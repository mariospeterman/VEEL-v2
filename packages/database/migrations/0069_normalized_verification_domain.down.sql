drop policy if exists verification_events_staff_select on verification_events;
drop policy if exists verification_records_select_self_org_or_staff on verification_records;
drop policy if exists verification_sessions_select_self_org_or_staff on verification_sessions;

drop index if exists verification_events_session_idx;
drop index if exists verification_sessions_subject_purpose_idx;
drop index if exists verification_records_expiry_idx;
drop index if exists verification_records_subject_purpose_idx;

drop table if exists verification_events;
drop table if exists verification_records;
drop table if exists verification_sessions;
