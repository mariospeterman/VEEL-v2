-- Creator profile and monetisation dashboard settings.
-- This stores readiness and product configuration, not custody or money movement queues.

create table creator_monetisation_settings (
  user_id uuid primary key references users(id),
  state text not null default 'active',
  earning_state text not null default 'not_configured',
  kyc_state text not null default 'not_required',
  tax_profile_state text not null default 'not_required',
  earnings_recipient_wallet_id uuid references wallets(id),
  tips_enabled boolean not null default true,
  content_unlocks_enabled boolean not null default true,
  live_passes_enabled boolean not null default true,
  paid_messages_enabled boolean not null default true,
  subscriptions_enabled boolean not null default false,
  min_tip_amount_minor bigint not null default 1000000,
  default_currency text not null default 'SOL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state in ('active', 'paused', 'blocked')),
  check (earning_state in ('not_configured', 'ready', 'review_required', 'held')),
  check (kyc_state in ('not_required', 'required', 'pending', 'verified', 'failed')),
  check (tax_profile_state in ('not_required', 'required', 'pending', 'verified')),
  check (default_currency in ('SOL', 'USDC')),
  check (min_tip_amount_minor > 0)
);

alter table creator_monetisation_settings enable row level security;

create policy creator_monetisation_settings_select_self_or_staff
  on creator_monetisation_settings for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create index creator_monetisation_settings_wallet_idx
  on creator_monetisation_settings (earnings_recipient_wallet_id)
  where earnings_recipient_wallet_id is not null;

create index creator_monetisation_settings_state_idx
  on creator_monetisation_settings (state, earning_state);
