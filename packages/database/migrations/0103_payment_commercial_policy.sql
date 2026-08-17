-- Backend-owned one-time payment policy, immutable quote evidence, and audited overrides.

create table payment_commercial_policy_overrides (
  id uuid primary key default gen_random_uuid(),
  product_type text not null,
  currency text not null,
  minimum_amount_minor bigint not null,
  platform_fee_bps integer not null,
  referral_share_of_platform_fee_bps integer not null,
  quote_ttl_seconds integer not null,
  state text not null default 'active',
  revision integer not null default 1,
  reason text not null,
  updated_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_commercial_policy_product_check check (
    product_type in ('support', 'content_unlock', 'paid_message', 'live_pass', 'event_access_pass')
  ),
  constraint payment_commercial_policy_currency_check check (currency in ('SOL', 'USDC')),
  constraint payment_commercial_policy_minimum_check check (
    minimum_amount_minor between 1 and 9007199254740991
  ),
  constraint payment_commercial_policy_platform_fee_check check (
    platform_fee_bps between 0 and 9999
  ),
  constraint payment_commercial_policy_referral_share_check check (
    referral_share_of_platform_fee_bps between 0 and 10000
  ),
  constraint payment_commercial_policy_quote_ttl_check check (
    quote_ttl_seconds between 60 and 1800
  ),
  constraint payment_commercial_policy_state_check check (state in ('active', 'inactive')),
  constraint payment_commercial_policy_revision_check check (revision > 0),
  unique (product_type, currency)
);

create index payment_commercial_policy_overrides_updated_at_idx
  on payment_commercial_policy_overrides (updated_at desc);

alter table payment_commercial_policy_overrides enable row level security;
grant select on table payment_commercial_policy_overrides to authenticated;

create policy payment_commercial_policy_overrides_select_staff
  on payment_commercial_policy_overrides for select to authenticated
  using ((select private.is_staff_member()));

alter table payment_intents
  add column commercial_policy_source text not null default 'legacy_environment_default',
  add column commercial_policy_override_id uuid references payment_commercial_policy_overrides(id),
  add column commercial_policy_revision integer not null default 0,
  add column minimum_amount_minor bigint not null default 1,
  add column platform_fee_bps integer not null default 0,
  add column referral_share_of_platform_fee_bps integer not null default 0,
  add column quoted_at timestamptz;

update payment_intents
set quoted_at = least(created_at, expires_at - interval '1 second')
where quoted_at is null;

alter table payment_intents
  alter column quoted_at set not null,
  alter column quoted_at set default now(),
  add constraint payment_intents_commercial_policy_source_check check (
    commercial_policy_source in ('environment_default', 'admin_override', 'legacy_environment_default')
  ),
  add constraint payment_intents_commercial_policy_revision_check check (
    commercial_policy_revision >= 0
  ),
  add constraint payment_intents_minimum_amount_check check (
    minimum_amount_minor between 1 and 9007199254740991
    and amount_minor >= minimum_amount_minor
  ),
  add constraint payment_intents_platform_fee_bps_check check (
    platform_fee_bps between 0 and 9999
  ),
  add constraint payment_intents_referral_share_bps_check check (
    referral_share_of_platform_fee_bps between 0 and 10000
  ),
  add constraint payment_intents_quote_window_check check (
    expires_at > quoted_at
    and expires_at <= quoted_at + interval '30 minutes'
  );

comment on table payment_commercial_policy_overrides is
  'Audited backend commercial overrides. Feature flags and browser payloads are never payment policy.';
comment on column payment_intents.quoted_at is
  'Creation time of the immutable backend quote; expires_at is the quote expiry and payment capability ceiling.';
