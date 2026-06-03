-- Wallet foundation for embedded and external Solana wallet onboarding.
-- Payment proof and transaction settlement remain separate backend-owned flows.

create type wallet_chain as enum (
  'solana_devnet',
  'solana_mainnet'
);

create type wallet_provider as enum (
  'embedded_privy',
  'embedded_turnkey',
  'phantom',
  'solflare',
  'wallet_adapter'
);

create table wallets (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider wallet_provider not null,
  provider_wallet_reference text,
  address text not null,
  chain wallet_chain not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain, address)
);

create unique index wallets_provider_reference_unique
  on wallets (provider, provider_wallet_reference)
  where provider_wallet_reference is not null;

create unique index wallets_one_primary_per_user_idx
  on wallets (user_id)
  where is_primary;

create index wallets_user_id_idx on wallets (user_id);
create index wallets_user_primary_idx on wallets (user_id, is_primary desc);
