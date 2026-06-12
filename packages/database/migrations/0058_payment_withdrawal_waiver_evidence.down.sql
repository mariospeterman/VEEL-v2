drop index if exists payment_intents_withdrawal_waiver_idx;

alter table payment_intents
  drop column if exists refund_value_basis,
  drop column if exists durable_confirmation_required,
  drop column if exists terms_version,
  drop column if exists withdrawal_waiver_version,
  drop column if exists withdrawal_waiver_accepted_at,
  drop column if exists withdrawal_waiver_required;
