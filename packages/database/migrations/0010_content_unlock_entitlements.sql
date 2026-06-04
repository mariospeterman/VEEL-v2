-- Content unlock entitlement grants.
-- Backend-confirmed settlement is the only path that grants paid content access.

create table entitlements (
  id uuid primary key,
  user_id uuid not null references users(id),
  target_type text not null,
  target_id uuid not null,
  product_type text not null,
  payment_intent_id uuid references payment_intents(id),
  state text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_intent_id)
);

create table entitlement_events (
  id uuid primary key,
  entitlement_id uuid not null references entitlements(id),
  actor_user_id uuid references users(id),
  action text not null,
  payment_intent_id uuid references payment_intents(id),
  created_at timestamptz not null default now()
);

alter table entitlements enable row level security;
alter table entitlement_events enable row level security;

create unique index entitlements_active_content_unlock_idx
  on entitlements (user_id, target_id, product_type)
  where target_type = 'content' and product_type = 'content_unlock' and state = 'active';

create index entitlements_user_target_idx
  on entitlements (user_id, target_type, target_id, state);

create index entitlement_events_entitlement_created_at_idx
  on entitlement_events (entitlement_id, created_at desc);
