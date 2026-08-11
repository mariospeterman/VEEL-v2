-- Wallet-compatible Solana Pay checkout capabilities and one-time SPL/USDC settlement facts.

alter table creator_monetisation_settings
  rename column tips_enabled to support_enabled;

alter table payment_intents
  add column checkout_token_hash text,
  add column token_mint text,
  add column token_decimals smallint;

alter table payment_intents
  add constraint payment_intents_currency_asset_check
    check (
      (currency = 'SOL' and token_mint is null and token_decimals is null)
      or
      (currency = 'USDC' and token_mint is not null and token_decimals between 0 and 18)
    ),
  add constraint payment_intents_javascript_safe_atomic_amounts_check
    check (
      amount_minor between 1 and 9007199254740991
      and total_amount_minor between 1 and 9007199254740991
      and creator_amount_minor between 1 and 9007199254740991
      and platform_fee_amount_minor between 0 and 9007199254740991
      and allocation_amount_minor between 0 and 9007199254740991
    );

create unique index payment_intents_checkout_token_hash_uidx
  on payment_intents (checkout_token_hash)
  where checkout_token_hash is not null;

alter table payment_settlement_attempts
  add column observed_block_time timestamptz;
