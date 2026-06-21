-- Non-custodial creator split settlement facts for native SOL payment intents.
-- Creator payments are not platform balances; the backend stores verified on-chain facts only.

alter table payment_intents
  add column settlement_kind text not null default 'creator_split',
  add column buyer_wallet text,
  add column creator_wallet text,
  add column platform_fee_wallet text,
  add column allocation_wallet text,
  add column total_amount_minor bigint,
  add column creator_amount_minor bigint,
  add column platform_fee_amount_minor bigint not null default 0,
  add column allocation_amount_minor bigint not null default 0,
  add column failed_at timestamptz,
  add column failure_reason text;

update payment_intents
set
  settlement_kind = 'dev_test',
  creator_wallet = coalesce(creator_wallet, treasury_wallet),
  platform_fee_wallet = coalesce(platform_fee_wallet, treasury_wallet),
  total_amount_minor = coalesce(total_amount_minor, amount_minor),
  creator_amount_minor = coalesce(creator_amount_minor, amount_minor),
  platform_fee_amount_minor = coalesce(platform_fee_amount_minor, 0),
  allocation_amount_minor = coalesce(allocation_amount_minor, 0);

alter table payment_intents
  alter column creator_wallet set not null,
  alter column platform_fee_wallet set not null,
  alter column total_amount_minor set not null,
  alter column creator_amount_minor set not null;

alter table payment_intents
  add constraint payment_intents_settlement_kind_check
    check (settlement_kind in ('creator_split', 'platform_owned', 'dev_test')),
  add constraint payment_intents_split_amounts_nonnegative_check
    check (
      total_amount_minor > 0
      and creator_amount_minor > 0
      and platform_fee_amount_minor >= 0
      and allocation_amount_minor >= 0
    ),
  add constraint payment_intents_split_total_check
    check (total_amount_minor = creator_amount_minor + platform_fee_amount_minor + allocation_amount_minor),
  add constraint payment_intents_creator_split_wallets_check
    check (
      settlement_kind <> 'creator_split'
      or (
        creator_wallet <> platform_fee_wallet
        and creator_wallet <> treasury_wallet
      )
    );

create unique index payment_intents_submitted_signature_uidx
  on payment_intents (submitted_signature)
  where submitted_signature is not null;

create index payment_intents_creator_wallet_idx
  on payment_intents (creator_wallet);

create index payment_intents_settlement_kind_state_idx
  on payment_intents (settlement_kind, state);
