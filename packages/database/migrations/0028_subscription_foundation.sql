-- Noncustodial auto-renewing subscription foundation.
-- Primary path follows the Solana Subscription Delegation Program: user authorizes once,
-- backend/worker collections recur within bounded plan terms until cancel/revoke.

create table subscription_plans (
  id text primary key,
  scope text not null check (scope in ('platform', 'creator')),
  creator_user_id uuid references users(id),
  label text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'USDC' check (currency in ('SOL', 'USDC')),
  period_days integer not null check (period_days between 1 and 366),
  billing_mode text not null default 'delegated_solana_subscription'
    check (billing_mode in ('manual_solana_pay', 'delegated_solana_subscription')),
  provider_state text not null default 'staging_required'
    check (provider_state in ('fallback_active', 'staging_required', 'disabled')),
  token_mint text,
  token_program text check (token_program in ('spl_token', 'token_2022')),
  provider_plan_reference text,
  state text not null default 'active' check (state in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'creator' and creator_user_id is not null) or (scope = 'platform' and creator_user_id is null)),
  check (
    billing_mode != 'delegated_solana_subscription'
    or (token_mint is not null and token_program is not null)
  )
);

create table subscriptions (
  id uuid primary key,
  subscriber_user_id uuid not null references users(id),
  scope text not null check (scope in ('platform', 'creator')),
  plan_id text not null references subscription_plans(id),
  creator_user_id uuid references users(id),
  state text not null default 'authorization_pending'
    check (state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period', 'cancelled', 'suspended', 'expired', 'revoked')),
  renewal_mode text not null default 'delegated_solana_subscription'
    check (renewal_mode in ('manual_solana_pay', 'delegated_solana_subscription')),
  authority_address text,
  delegation_address text,
  subscriber_token_account text,
  collector_address text,
  provider_reference text,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  next_collection_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'creator' and creator_user_id is not null) or (scope = 'platform' and creator_user_id is null)),
  check (subscriber_user_id <> creator_user_id)
);

create table subscription_authorization_intents (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  idempotency_key text not null,
  request_hash text not null,
  state text not null default 'created'
    check (state in ('created', 'submitted', 'verified', 'expired', 'cancelled')),
  authorization_mode text not null default 'delegated_solana_subscription'
    check (authorization_mode = 'delegated_solana_subscription'),
  setup_reference text not null unique,
  transaction_request_url text,
  submitted_signature text unique,
  verified_signature text unique,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, idempotency_key)
);

create table subscription_collections (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('SOL', 'USDC')),
  state text not null default 'due'
    check (state in ('due', 'submitted', 'confirmed', 'failed', 'skipped', 'cancelled')),
  collection_signature text unique,
  failure_code text,
  due_at timestamptz not null,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_starts_at)
);

create table subscription_events (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  actor_user_id uuid references users(id),
  action text not null,
  authorization_intent_id uuid references subscription_authorization_intents(id),
  collection_id uuid references subscription_collections(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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
  token_program
)
values
  ('platform_plus_monthly', 'platform', 'Veel Plus', 15000000, 'USDC', 30, 'delegated_solana_subscription', 'staging_required', 'USDC_MINT_CONFIG_REQUIRED', 'spl_token'),
  ('platform_studio_monthly', 'platform', 'Veel Studio', 29000000, 'USDC', 30, 'delegated_solana_subscription', 'staging_required', 'USDC_MINT_CONFIG_REQUIRED', 'spl_token')
on conflict (id) do nothing;

create unique index subscriptions_one_open_platform_plan_idx
  on subscriptions (subscriber_user_id, plan_id)
  where scope = 'platform' and state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period');

create unique index subscriptions_one_open_creator_plan_idx
  on subscriptions (subscriber_user_id, creator_user_id, plan_id)
  where scope = 'creator' and state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period');

create index subscription_plans_creator_idx
  on subscription_plans (creator_user_id)
  where creator_user_id is not null;

create index subscriptions_subscriber_created_at_idx
  on subscriptions (subscriber_user_id, created_at desc);

create index subscriptions_creator_state_idx
  on subscriptions (creator_user_id, state, created_at desc)
  where creator_user_id is not null;

create index subscriptions_next_collection_idx
  on subscriptions (next_collection_at)
  where state in ('active', 'renewal_pending', 'grace_period') and cancel_at_period_end = false;

create index subscription_authorization_intents_subscription_idx
  on subscription_authorization_intents (subscription_id, created_at desc);

create index subscription_collections_due_idx
  on subscription_collections (due_at, state);

create index subscription_collections_subscription_idx
  on subscription_collections (subscription_id, created_at desc);

create index subscription_events_subscription_created_at_idx
  on subscription_events (subscription_id, created_at desc);

create index subscription_events_actor_user_id_idx
  on subscription_events (actor_user_id)
  where actor_user_id is not null;

alter table subscription_plans enable row level security;
alter table subscriptions enable row level security;
alter table subscription_authorization_intents enable row level security;
alter table subscription_collections enable row level security;
alter table subscription_events enable row level security;

grant select on table subscription_plans to authenticated;
grant select on table subscriptions to authenticated;
grant select on table subscription_authorization_intents to authenticated;
grant select on table subscription_collections to authenticated;
grant select on table subscription_events to authenticated;

create policy subscription_plans_select_active_or_staff
  on subscription_plans for select to authenticated
  using (state = 'active' or (select private.is_staff_member()));

create policy subscriptions_select_self_creator_or_staff
  on subscriptions for select to authenticated
  using (
    subscriber_user_id = (select private.current_app_user_id())
    or creator_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy subscription_authorization_intents_select_self_creator_or_staff
  on subscription_authorization_intents for select to authenticated
  using (
    exists (
      select 1
      from subscriptions s
      where s.id = subscription_authorization_intents.subscription_id
        and (
          s.subscriber_user_id = (select private.current_app_user_id())
          or s.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );

create policy subscription_collections_select_self_creator_or_staff
  on subscription_collections for select to authenticated
  using (
    exists (
      select 1
      from subscriptions s
      where s.id = subscription_collections.subscription_id
        and (
          s.subscriber_user_id = (select private.current_app_user_id())
          or s.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );

create policy subscription_events_select_self_creator_or_staff
  on subscription_events for select to authenticated
  using (
    exists (
      select 1
      from subscriptions s
      where s.id = subscription_events.subscription_id
        and (
          s.subscriber_user_id = (select private.current_app_user_id())
          or s.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );
