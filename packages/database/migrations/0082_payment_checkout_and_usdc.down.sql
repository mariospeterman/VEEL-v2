alter table payment_settlement_attempts
  drop column if exists observed_block_time;

drop index if exists payment_intents_checkout_token_hash_uidx;

alter table payment_intents
  drop constraint if exists payment_intents_currency_asset_check,
  drop constraint if exists payment_intents_javascript_safe_atomic_amounts_check,
  drop column if exists token_decimals,
  drop column if exists token_mint,
  drop column if exists checkout_token_hash;

alter table creator_monetisation_settings
  rename column support_enabled to tips_enabled;
