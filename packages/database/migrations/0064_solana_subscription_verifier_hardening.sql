-- Harden recurring subscriptions around official Solana token subscription verification.
-- This is noncustodial state only: no balances, no custody, no payout queues.

alter table subscription_plans
  add column if not exists provider text not null default 'official_solana_subscription_program',
  add column if not exists program_id text,
  add column if not exists plan_pda text,
  add column if not exists onchain_plan_id text,
  add column if not exists merchant_wallet text,
  add column if not exists amount_atomic bigint,
  add column if not exists period_seconds integer,
  add column if not exists creator_amount_atomic bigint not null default 0,
  add column if not exists platform_fee_amount_atomic bigint not null default 0,
  add column if not exists allocation_amount_atomic bigint not null default 0,
  add column if not exists metadata_uri text;

update subscription_plans
set
  provider_state = case when provider_state = 'fallback_active' then 'disabled' else provider_state end,
  state = case
    when state = 'active' and provider_state <> 'launch_approved' then 'disabled'
    else state
  end,
  program_id = coalesce(program_id, 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'),
  amount_atomic = coalesce(amount_atomic, amount_minor),
  period_seconds = coalesce(period_seconds, period_days * 86400),
  creator_amount_atomic = case
    when scope = 'creator' and creator_amount_atomic = 0 then amount_minor
    else creator_amount_atomic
  end,
  platform_fee_amount_atomic = platform_fee_amount_atomic,
  allocation_amount_atomic = allocation_amount_atomic;

alter table subscription_plans
  drop constraint if exists subscription_plans_provider_state_check,
  alter column amount_atomic set not null,
  alter column period_seconds set not null,
  add constraint subscription_plans_provider_state_check
    check (provider_state in ('staging_required', 'launch_approved', 'disabled')),
  add constraint subscription_plans_provider_check
    check (provider in ('official_solana_subscription_program', 'mock_subscription_provider_dev_only')),
  add constraint subscription_plans_token_only_check
    check (currency <> 'SOL' and token_mint is not null and token_program in ('spl_token', 'token_2022')),
  add constraint subscription_plans_amount_atomic_check
    check (amount_atomic > 0 and period_seconds > 0),
  add constraint subscription_plans_split_amounts_check
    check (
      creator_amount_atomic >= 0
      and platform_fee_amount_atomic >= 0
      and allocation_amount_atomic >= 0
      and creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic <= amount_atomic
    ),
  add constraint subscription_plans_onchain_active_check
    check (state <> 'active' or provider_state = 'launch_approved');

alter table subscriptions
  add column if not exists subscriber_wallet text,
  add column if not exists user_token_account text,
  add column if not exists token_mint text,
  add column if not exists subscription_authority_pda text,
  add column if not exists subscription_pda text,
  add column if not exists provider text not null default 'official_solana_subscription_program',
  add column if not exists program_id text,
  add column if not exists amount_atomic bigint,
  add column if not exists period_seconds integer,
  add column if not exists start_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists setup_signature text,
  add column if not exists verified_signature text,
  add column if not exists verified_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists plan_pda text,
  add column if not exists merchant_wallet text;

update subscriptions s
set
  user_token_account = coalesce(s.user_token_account, s.subscriber_token_account),
  subscription_authority_pda = coalesce(s.subscription_authority_pda, s.authority_address),
  program_id = coalesce(s.program_id, sp.program_id),
  token_mint = coalesce(s.token_mint, sp.token_mint),
  amount_atomic = coalesce(s.amount_atomic, sp.amount_atomic),
  period_seconds = coalesce(s.period_seconds, sp.period_seconds),
  plan_pda = coalesce(s.plan_pda, sp.plan_pda),
  merchant_wallet = coalesce(s.merchant_wallet, sp.merchant_wallet),
  start_at = coalesce(s.start_at, s.current_period_starts_at),
  expires_at = coalesce(s.expires_at, s.current_period_ends_at),
  verified_at = coalesce(s.verified_at, s.current_period_starts_at)
from subscription_plans sp
where sp.id = s.plan_id;

alter table subscriptions
  add constraint subscriptions_provider_check
    check (provider in ('official_solana_subscription_program', 'mock_subscription_provider_dev_only')),
  add constraint subscriptions_token_only_check
    check (renewal_mode <> 'delegated_solana_subscription' or (token_mint is not null and amount_atomic is not null and period_seconds is not null)),
  add constraint subscriptions_amount_period_check
    check (
      (amount_atomic is null or amount_atomic > 0)
      and (period_seconds is null or period_seconds > 0)
    );

alter table subscription_authorization_intents
  add column if not exists provider text not null default 'official_solana_subscription_program',
  add column if not exists program_id text,
  add column if not exists subscriber_wallet text,
  add column if not exists subscriber_token_account text,
  add column if not exists token_mint text,
  add column if not exists subscription_authority_pda text,
  add column if not exists subscription_pda text,
  add column if not exists failure_reason text;

update subscription_authorization_intents sai
set
  program_id = coalesce(sai.program_id, s.program_id),
  subscriber_wallet = coalesce(sai.subscriber_wallet, s.subscriber_wallet),
  subscriber_token_account = coalesce(sai.subscriber_token_account, s.subscriber_token_account),
  token_mint = coalesce(sai.token_mint, s.token_mint),
  subscription_authority_pda = coalesce(sai.subscription_authority_pda, s.subscription_authority_pda),
  subscription_pda = coalesce(sai.subscription_pda, s.subscription_pda)
from subscriptions s
where s.id = sai.subscription_id;

alter table subscription_collections
  add column if not exists amount_atomic bigint,
  add column if not exists creator_amount_atomic bigint not null default 0,
  add column if not exists platform_fee_amount_atomic bigint not null default 0,
  add column if not exists allocation_amount_atomic bigint not null default 0,
  add column if not exists collector_wallet text,
  add column if not exists receiver_wallet text,
  add column if not exists receiver_token_account text,
  add column if not exists idempotency_key text,
  add column if not exists attempted_at timestamptz;

update subscription_collections sc
set
  amount_atomic = coalesce(sc.amount_atomic, sc.amount_minor),
  attempted_at = coalesce(attempted_at, submitted_at)
from subscriptions s
where s.id = sc.subscription_id;

alter table subscription_collections
  alter column amount_atomic set not null,
  add constraint subscription_collections_amount_atomic_check
    check (
      amount_atomic > 0
      and creator_amount_atomic >= 0
      and platform_fee_amount_atomic >= 0
      and allocation_amount_atomic >= 0
      and creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic <= amount_atomic
    );

create unique index if not exists subscription_authorization_intents_verified_signature_uidx
  on subscription_authorization_intents (verified_signature)
  where verified_signature is not null;

create unique index if not exists subscription_authorization_intents_submitted_signature_uidx
  on subscription_authorization_intents (submitted_signature)
  where submitted_signature is not null;

create unique index if not exists subscription_collections_signature_uidx
  on subscription_collections (collection_signature)
  where collection_signature is not null;

create unique index if not exists subscription_collections_idempotency_uidx
  on subscription_collections (idempotency_key)
  where idempotency_key is not null;

create index if not exists subscription_plans_provider_status_idx
  on subscription_plans (provider, provider_state, state);

create index if not exists subscriptions_user_plan_status_idx
  on subscriptions (subscriber_user_id, plan_id, state);

create index if not exists subscriptions_creator_status_idx
  on subscriptions (creator_user_id, state)
  where creator_user_id is not null;

create index if not exists subscriptions_status_expires_idx
  on subscriptions (state, expires_at);
