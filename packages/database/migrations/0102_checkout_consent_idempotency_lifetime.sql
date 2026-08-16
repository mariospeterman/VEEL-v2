-- Checkout consent is durable legal/business state, so its replay receipt must outlive the intent window.

update idempotency_keys
set expires_at = 'infinity'::timestamptz
where scope = 'payment_checkout_consent';

comment on table idempotency_keys is
  'Generic replay receipts. Durable business mutations use infinity; only intrinsically time-bounded operations retain finite expiry.';
