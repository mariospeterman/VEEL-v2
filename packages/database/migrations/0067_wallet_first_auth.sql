-- Wallet-first account sessions.
-- These records authenticate a user-controlled wallet to Veel. They are not payment proof.

create table wallet_auth_challenges (
  id uuid primary key,
  chain wallet_chain not null,
  provider wallet_provider not null,
  address text not null,
  message text not null,
  nonce_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index wallet_auth_challenges_nonce_hash_unique
  on wallet_auth_challenges (nonce_hash);

create index wallet_auth_challenges_address_created_idx
  on wallet_auth_challenges (chain, address, created_at desc);

create index wallet_auth_challenges_expires_at_idx
  on wallet_auth_challenges (expires_at);

create table wallet_auth_sessions (
  id uuid primary key,
  user_id uuid not null references users(id),
  wallet_id uuid not null references wallets(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index wallet_auth_sessions_user_created_idx
  on wallet_auth_sessions (user_id, created_at desc);

create index wallet_auth_sessions_expires_at_idx
  on wallet_auth_sessions (expires_at);

alter table wallet_auth_challenges enable row level security;
alter table wallet_auth_sessions enable row level security;

grant select on table wallet_auth_challenges to authenticated;
grant select on table wallet_auth_sessions to authenticated;

create policy wallet_auth_challenges_staff_select
  on wallet_auth_challenges for select to authenticated
  using ((select private.is_staff_member()));

create policy wallet_auth_sessions_staff_select
  on wallet_auth_sessions for select to authenticated
  using ((select private.is_staff_member()));
