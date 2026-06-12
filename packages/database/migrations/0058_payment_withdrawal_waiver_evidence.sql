-- Record the consumer-remedy evidence needed for instant digital access.
-- This is policy/audit evidence only; it does not execute refunds or create balances.

alter table payment_intents
  add column withdrawal_waiver_required boolean not null default true,
  add column withdrawal_waiver_accepted_at timestamptz not null default now(),
  add column withdrawal_waiver_version text not null default 'instant-digital-access-v1',
  add column terms_version text not null default 'veel-terms-v1',
  add column durable_confirmation_required boolean not null default true,
  add column refund_value_basis text not null default 'manual_resolution'
    check (refund_value_basis in ('original_crypto_amount', 'fiat_value_at_purchase', 'manual_resolution'));

create index payment_intents_withdrawal_waiver_idx
  on payment_intents (withdrawal_waiver_required, withdrawal_waiver_accepted_at desc);
