-- Backend-owned five-tier policy, usage projection, and one profile membership offer.

alter table tier_waivers
  drop constraint if exists tier_waivers_tier_key_check;

alter table tier_waivers
  add constraint tier_waivers_tier_key_check
    check (tier_key in ('free_verified', 'veel_plus', 'veel_ultra', 'veel_studio', 'enterprise'));

update subscription_plans
set
  label = 'Veel Plus',
  amount_minor = 8990000,
  amount_atomic = 8990000,
  updated_at = now()
where id = 'platform_plus_monthly';

insert into subscription_plans (
  id,
  scope,
  label,
  amount_minor,
  currency,
  period_days,
  billing_mode,
  provider_state,
  token_mint,
  token_program,
  provider,
  program_id,
  amount_atomic,
  period_seconds,
  state
)
values (
  'platform_ultra_monthly',
  'platform',
  'Veel Ultra',
  17990000,
  'USDC',
  30,
  'delegated_solana_subscription',
  'disabled',
  'USDC_MINT_CONFIG_REQUIRED',
  'spl_token',
  'official_solana_subscription_program',
  'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44',
  17990000,
  2592000,
  'disabled'
)
on conflict (id) do update set
  label = excluded.label,
  amount_minor = excluded.amount_minor,
  amount_atomic = excluded.amount_atomic,
  updated_at = now();

create table platform_tier_policies (
  tier_key text primary key
    check (tier_key in ('free_verified', 'veel_plus', 'veel_ultra', 'veel_studio', 'enterprise')),
  label text not null,
  rank integer not null unique check (rank between 0 and 100),
  monthly_price_minor bigint check (monthly_price_minor is null or monthly_price_minor >= 0),
  currency text check (currency is null or currency = 'USDC'),
  public_media_allowance_seconds bigint
    check (public_media_allowance_seconds is null or public_media_allowance_seconds >= 0),
  subscription_plan_id text references subscription_plans(id),
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  state text not null default 'active' check (state in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tier_key in ('free_verified', 'enterprise')) = (subscription_plan_id is null))
);

insert into platform_tier_policies (
  tier_key,
  label,
  rank,
  monthly_price_minor,
  currency,
  public_media_allowance_seconds,
  subscription_plan_id,
  capabilities
)
values
  ('free_verified', 'Free Verified', 0, 0, 'USDC', 72000, null,
    '["social","bits","publish_sfw","public_live","buy","support"]'::jsonb),
  ('veel_plus', 'Veel Plus', 10, 8990000, 'USDC', 360000, 'platform_plus_monthly',
    '["social","bits","publish_sfw","public_live","buy","support","collections","privacy_controls","profile_enhancements"]'::jsonb),
  ('veel_ultra', 'Veel Ultra', 20, 17990000, 'USDC', 900000, 'platform_ultra_monthly',
    '["social","bits","publish_sfw","public_live","buy","support","collections","privacy_controls","profile_enhancements","highest_playback_quality","playback_convenience"]'::jsonb),
  ('veel_studio', 'Veel Studio', 30, 29000000, 'USDC', 900000, 'platform_studio_monthly',
    '["social","bits","publish_sfw","public_live","buy","support","collections","privacy_controls","profile_enhancements","highest_playback_quality","playback_convenience","advanced_analytics","scheduling","pricing_tools","profile_membership","live_conversion","ai_assistance"]'::jsonb),
  ('enterprise', 'Enterprise', 40, 199000000, 'USDC', null, null,
    '["social","bits","publish_sfw","public_live","buy","support","organization","kyb","seats","rbac","approvals","api_access","consolidated_reporting"]'::jsonb);

create table platform_usage_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  public_media_seconds bigint not null default 0 check (public_media_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, window_starts_at),
  check (window_ends_at > window_starts_at)
);

create index platform_usage_windows_user_ends_idx
  on platform_usage_windows (user_id, window_ends_at desc);

with ranked_creator_plans as (
  select
    id,
    row_number() over (
      partition by creator_user_id
      order by updated_at desc, created_at desc, id
    ) as position
  from subscription_plans
  where scope = 'creator'
    and state = 'active'
)
update subscription_plans sp
set state = 'disabled', updated_at = now()
from ranked_creator_plans ranked
where ranked.id = sp.id
  and ranked.position > 1;

create unique index subscription_plans_one_active_creator_offer_idx
  on subscription_plans (creator_user_id)
  where scope = 'creator' and state = 'active';

alter table platform_tier_policies enable row level security;
alter table platform_usage_windows enable row level security;

grant select on table platform_tier_policies to authenticated;
grant select on table platform_usage_windows to authenticated;

create policy platform_tier_policies_select_active_or_staff
  on platform_tier_policies for select to authenticated
  using (state = 'active' or (select private.is_staff_member()));

create policy platform_usage_windows_select_self_or_staff
  on platform_usage_windows for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );
