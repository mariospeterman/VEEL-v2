drop index if exists provider_event_replay_requests_lease_due_idx;
update provider_event_replay_requests set state = 'failed' where state = 'dead_letter';
alter table provider_event_replay_requests
  drop constraint provider_event_replay_requests_state_check,
  drop column next_attempt_at,
  drop column leased_until,
  drop column lease_token;
alter table provider_event_replay_requests
  add constraint provider_event_replay_requests_state_check
    check (state in ('queued', 'processing', 'replayed', 'failed', 'cancelled'));

drop index if exists payment_confirmation_deliveries_lease_due_idx;
update payment_confirmation_deliveries set state = 'failed' where state = 'dead_letter';
alter table payment_confirmation_deliveries
  drop constraint payment_confirmation_deliveries_state_check,
  drop column next_attempt_at,
  drop column leased_until,
  drop column lease_token;
alter table payment_confirmation_deliveries
  add constraint payment_confirmation_deliveries_state_check
    check (state in ('queued', 'processing', 'sent', 'provider_not_configured', 'failed'));

drop index if exists notification_delivery_attempts_lease_due_idx;
update notification_delivery_attempts set state = 'failed' where state = 'dead_letter';
alter table notification_delivery_attempts
  drop column leased_until,
  drop column lease_token;
-- PostgreSQL enum values are intentionally not removed during rollback.

drop index if exists subscription_collections_lease_due_idx;
update subscription_collections set state = 'failed' where state = 'dead_letter';
update subscription_collections set state = 'submitted' where state = 'processing';
alter table subscription_collections
  drop constraint subscription_collections_state_check,
  drop column next_attempt_at,
  drop column leased_until,
  drop column lease_token,
  drop column attempt_count;
alter table subscription_collections
  add constraint subscription_collections_state_check
    check (state in ('due', 'submitted', 'confirmed', 'failed', 'skipped', 'cancelled'));
drop table if exists worker_queue_recovery_requests;
