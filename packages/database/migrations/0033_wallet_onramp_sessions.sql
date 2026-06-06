-- Wallet funding session references. These are UX/support records only, not payment proof.

create type wallet_onramp_session_state as enum (
  'created',
  'completed',
  'failed',
  'expired',
  'canceled'
);

create table wallet_onramp_sessions (
  id uuid primary key,
  user_id uuid not null references users(id),
  wallet_id uuid not null references wallets(id),
  idempotency_key text not null,
  provider text not null,
  provider_session_reference_hash text not null,
  wallet_address text not null,
  chain wallet_chain not null,
  purchase_currency text not null,
  launch_url text not null,
  return_url text,
  state wallet_onramp_session_state not null default 'created',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (provider, provider_session_reference_hash)
);

create index wallet_onramp_sessions_user_created_idx
  on wallet_onramp_sessions (user_id, created_at desc);

create index wallet_onramp_sessions_wallet_created_idx
  on wallet_onramp_sessions (wallet_id, created_at desc);

alter table wallet_onramp_sessions enable row level security;

grant select on table wallet_onramp_sessions to authenticated;

create policy wallet_onramp_sessions_select_self_or_staff
  on wallet_onramp_sessions for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
