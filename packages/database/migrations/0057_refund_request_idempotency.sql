-- Persist refund/dispute idempotency so retrying a user request cannot create
-- duplicate refund obligations or duplicate review queues.

alter table refunds_and_disputes
  add column idempotency_key text,
  add column request_hash text;

update refunds_and_disputes
set
  idempotency_key = coalesce(idempotency_key, 'legacy:' || id::text),
  request_hash = coalesce(request_hash, 'legacy:' || id::text);

alter table refunds_and_disputes
  alter column idempotency_key set not null,
  alter column request_hash set not null;

create unique index refunds_and_disputes_reporter_idempotency_idx
  on refunds_and_disputes (reporter_user_id, idempotency_key);
