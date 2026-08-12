alter table audit_events
  add column if not exists idempotency_key text;

create unique index if not exists audit_events_actor_action_idempotency_uidx
  on audit_events (actor_user_id, action, idempotency_key)
  where actor_user_id is not null and idempotency_key is not null;
