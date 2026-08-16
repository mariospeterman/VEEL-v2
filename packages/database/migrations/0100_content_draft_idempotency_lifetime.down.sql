comment on table idempotency_keys is null;

update idempotency_keys
set expires_at = created_at + interval '24 hours'
where scope = 'content.create'
  and expires_at = 'infinity'::timestamptz;
