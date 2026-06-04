-- Referral attribution and commission foundation.
-- Frontend may submit a referral token, but backend owns attribution and commission amounts.

create table referral_tokens (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  token text unique not null,
  target_type text not null,
  target_id uuid not null,
  channel text not null,
  eligibility text not null,
  state text not null default 'active',
  idempotency_key text not null,
  request_hash text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (creator_user_id, idempotency_key)
);

create table referral_attributions (
  id uuid primary key,
  referral_token_id uuid not null references referral_tokens(id),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null references users(id),
  payment_intent_id uuid not null references payment_intents(id),
  state text not null default 'attributed',
  rejection_reason text,
  created_at timestamptz not null default now(),
  unique (payment_intent_id),
  unique (referral_token_id, referred_user_id, payment_intent_id)
);

create table referral_commissions (
  id uuid primary key,
  referral_attribution_id uuid not null references referral_attributions(id),
  referral_token_id uuid not null references referral_tokens(id),
  payment_intent_id uuid not null references payment_intents(id),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null,
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (payment_intent_id, referral_token_id)
);

alter table payment_intents
  add column referral_token_id uuid references referral_tokens(id);

alter table referral_tokens enable row level security;
alter table referral_attributions enable row level security;
alter table referral_commissions enable row level security;

create index referral_tokens_creator_created_at_idx
  on referral_tokens (creator_user_id, created_at desc);

create index referral_tokens_target_idx
  on referral_tokens (target_type, target_id, created_at desc);

create index referral_attributions_referred_created_at_idx
  on referral_attributions (referred_user_id, created_at desc);

create index referral_commissions_referrer_created_at_idx
  on referral_commissions (referrer_user_id, created_at desc);
