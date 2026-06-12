drop index if exists refunds_and_disputes_reporter_idempotency_idx;

alter table refunds_and_disputes
  drop column if exists request_hash,
  drop column if exists idempotency_key;
