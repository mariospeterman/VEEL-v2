drop index if exists audit_events_created_at_idx;
drop index if exists audit_events_subject_idx;
drop index if exists audit_events_actor_user_id_idx;
drop index if exists idempotency_keys_expires_at_idx;
drop index if exists idempotency_keys_actor_user_id_idx;
drop index if exists provider_webhook_receipts_provider_received_at_idx;
drop index if exists provider_events_provider_received_at_idx;
drop index if exists staff_permissions_user_id_idx;
drop index if exists staff_memberships_user_id_idx;
drop index if exists profiles_handle_idx;

drop table if exists audit_events;
drop table if exists idempotency_keys;
drop table if exists provider_webhook_receipts;
drop table if exists provider_events;
drop table if exists staff_permissions;
drop table if exists staff_memberships;
drop table if exists profiles;
drop table if exists users;

drop type if exists staff_role;
