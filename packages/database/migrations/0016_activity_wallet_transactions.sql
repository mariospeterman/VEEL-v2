-- User activity and wallet transaction read model.
-- Wallet records are backend-observed transaction references, not payment proof or custody.

create table wallet_transaction_records (
  id uuid primary key,
  user_id uuid not null references users(id),
  wallet_id uuid references wallets(id),
  payment_intent_id uuid references payment_intents(id),
  chain text not null,
  direction text not null,
  amount_minor bigint not null,
  currency text not null,
  state text not null,
  source text not null default 'payment_intent',
  signature text,
  reference_address text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (chain in ('solana_devnet', 'solana_mainnet')),
  check (direction in ('outgoing', 'incoming')),
  check (state in ('submitted', 'confirmed', 'failed')),
  check (source in ('payment_intent', 'subscription_collection', 'manual_adjustment'))
);

alter table wallet_transaction_records enable row level security;

create unique index wallet_transaction_records_payment_signature_unique
  on wallet_transaction_records (payment_intent_id, signature)
  where payment_intent_id is not null and signature is not null;

create index wallet_transaction_records_user_created_at_idx
  on wallet_transaction_records (user_id, created_at desc);

create index wallet_transaction_records_intent_idx
  on wallet_transaction_records (payment_intent_id);

create index wallet_transaction_records_signature_idx
  on wallet_transaction_records (signature)
  where signature is not null;
