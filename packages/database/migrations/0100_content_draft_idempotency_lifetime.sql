-- Preserve content-draft replay receipts for the lifetime of the logical operation.

update idempotency_keys
set expires_at = 'infinity'::timestamptz
where scope = 'content.create';

comment on table idempotency_keys is
  'Server-only mutation replay receipts. Content-create receipts use infinity because the created draft remains the logical operation result.';
