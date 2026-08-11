drop index if exists messages_sender_idempotency_uidx;

alter table messages
  drop column if exists idempotency_key;
