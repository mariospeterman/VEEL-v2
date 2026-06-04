-- Native SOL devnet payment intent foundation.
-- Wallet signatures are not payment proof until backend settlement verification confirms transfer evidence.

create table payment_intents (
  id uuid primary key,
  user_id uuid not null references users(id),
  product_type text not null,
  target_id uuid not null,
  amount_minor bigint not null,
  currency text not null,
  state text not null default 'pending',
  idempotency_key text not null,
  request_hash text not null,
  solana_cluster text not null,
  treasury_wallet text not null,
  reference_address text not null unique,
  transaction_request_url text,
  transaction_requested_at timestamptz,
  submitted_signature text,
  submitted_at timestamptz,
  confirmed_signature text unique,
  confirmed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table payment_settlement_attempts (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  signature text not null,
  state text not null,
  checked_at timestamptz not null default now(),
  failure_code text
);

create index payment_intents_user_created_at_idx
  on payment_intents (user_id, created_at desc);

create index payment_intents_state_expires_at_idx
  on payment_intents (state, expires_at);

create index payment_settlement_attempts_intent_checked_at_idx
  on payment_settlement_attempts (payment_intent_id, checked_at desc);
