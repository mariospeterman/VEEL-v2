update idempotency_keys
set expires_at = created_at + interval '24 hours'
where scope = 'payment_checkout_consent'
  and expires_at = 'infinity'::timestamptz;

comment on table idempotency_keys is
  'Generic replay receipts; expiry policy is owned by each operation scope.';
