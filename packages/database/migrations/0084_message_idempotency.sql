-- Normal message retries must return the original message instead of inserting duplicates.
-- Paid settlement delivery remains idempotent through its unique payment_intent_id.

alter table messages
  add column if not exists idempotency_key text;

create unique index if not exists messages_sender_idempotency_uidx
  on messages (sender_user_id, idempotency_key)
  where idempotency_key is not null;
