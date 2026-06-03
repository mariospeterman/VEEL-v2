-- Replay-safe external wallet linking challenges.

create table wallet_link_challenges (
  id uuid primary key,
  user_id uuid not null references users(id),
  chain wallet_chain not null,
  provider wallet_provider not null,
  address text not null,
  message text not null,
  nonce_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index wallet_link_challenges_nonce_hash_unique
  on wallet_link_challenges (nonce_hash);

create index wallet_link_challenges_user_created_idx
  on wallet_link_challenges (user_id, created_at desc);

create index wallet_link_challenges_expires_at_idx
  on wallet_link_challenges (expires_at);
