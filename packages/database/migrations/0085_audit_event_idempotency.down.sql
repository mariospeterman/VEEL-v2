drop index if exists audit_events_actor_action_idempotency_uidx;

alter table audit_events
  drop column if exists idempotency_key;
