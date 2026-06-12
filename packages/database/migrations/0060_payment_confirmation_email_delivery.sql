-- Transactional email delivery state for durable payment confirmations.
-- Provider secrets stay in the worker environment; this table stores only
-- delivery metadata needed for audit, retry, and support review.

alter table payment_confirmation_deliveries
  drop constraint payment_confirmation_deliveries_state_check;

alter table payment_confirmation_deliveries
  add constraint payment_confirmation_deliveries_state_check
  check (state in ('queued', 'processing', 'sent', 'provider_not_configured', 'failed'));

alter table payment_confirmation_deliveries
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column leased_at timestamptz,
  add column failure_code text,
  add column provider_message_id text;

create index payment_confirmation_deliveries_provider_message_id_idx
  on payment_confirmation_deliveries (provider_message_id)
  where provider_message_id is not null;
