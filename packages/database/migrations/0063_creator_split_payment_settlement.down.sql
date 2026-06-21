drop index if exists payment_intents_settlement_kind_state_idx;
drop index if exists payment_intents_creator_wallet_idx;
drop index if exists payment_intents_submitted_signature_uidx;

alter table payment_intents
  drop constraint if exists payment_intents_creator_split_wallets_check,
  drop constraint if exists payment_intents_split_total_check,
  drop constraint if exists payment_intents_split_amounts_nonnegative_check,
  drop constraint if exists payment_intents_settlement_kind_check;

alter table payment_intents
  drop column if exists failure_reason,
  drop column if exists failed_at,
  drop column if exists allocation_amount_minor,
  drop column if exists platform_fee_amount_minor,
  drop column if exists creator_amount_minor,
  drop column if exists total_amount_minor,
  drop column if exists allocation_wallet,
  drop column if exists platform_fee_wallet,
  drop column if exists creator_wallet,
  drop column if exists buyer_wallet,
  drop column if exists settlement_kind;
