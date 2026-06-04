-- Events and ticketing foundation.
-- Backend owns event inventory, ticket issuance, QR tokens, and check-in state.

create table events (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  event_type text not null default 'physical',
  location_type text not null,
  location_label text,
  location_lat numeric,
  location_lng numeric,
  access_rule text not null default 'public_sale',
  state text not null default 'draft',
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) between 1 and 120),
  check (event_type in ('digital_live_stream', 'physical')),
  check (location_type in ('digital_live_stream', 'physical')),
  check (access_rule in ('public_sale', 'private_apply')),
  check (state in ('draft', 'published', 'sold_out', 'cancelled', 'completed')),
  check (ends_at is null or ends_at > starts_at),
  unique (creator_user_id, idempotency_key)
);

create table ticket_types (
  id uuid primary key,
  event_id uuid not null references events(id),
  label text not null,
  price_minor bigint,
  currency text not null default 'SOL',
  capacity integer not null,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  per_user_limit integer not null default 1,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  check (char_length(label) between 1 and 80),
  check (price_minor is null or price_minor >= 0),
  check (currency in ('SOL', 'USDC')),
  check (capacity > 0),
  check (per_user_limit between 1 and 20),
  check (state in ('active', 'paused', 'sold_out')),
  check (sale_ends_at is null or sale_starts_at is null or sale_ends_at > sale_starts_at)
);

create table ticket_purchase_requests (
  payment_intent_id uuid primary key references payment_intents(id),
  event_id uuid not null references events(id),
  ticket_type_id uuid not null references ticket_types(id),
  buyer_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null default 'SOL',
  state text not null default 'pending_payment',
  created_at timestamptz not null default now(),
  check (amount_minor > 0),
  check (currency in ('SOL', 'USDC')),
  check (state in ('pending_payment', 'ticket_granted', 'cancelled'))
);

create table ticket_entitlements (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticket_type_id uuid not null references ticket_types(id),
  holder_user_id uuid not null references users(id),
  payment_intent_id uuid unique references payment_intents(id),
  qr_token text unique not null,
  qr_token_hash text unique not null,
  state text not null default 'active',
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state in ('active', 'checked_in', 'revoked', 'expired'))
);

create table ticket_requests (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticket_type_id uuid not null references ticket_types(id),
  requester_user_id uuid not null references users(id),
  note text,
  state text not null default 'requested',
  reviewed_by_user_id uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (note is null or char_length(note) <= 500),
  check (state in ('requested', 'approved', 'rejected', 'expired')),
  unique (event_id, ticket_type_id, requester_user_id)
);

alter table events enable row level security;
alter table ticket_types enable row level security;
alter table ticket_purchase_requests enable row level security;
alter table ticket_entitlements enable row level security;
alter table ticket_requests enable row level security;

create index events_creator_created_at_idx
  on events (creator_user_id, created_at desc);

create index events_state_starts_at_idx
  on events (state, starts_at);

create index ticket_types_event_state_idx
  on ticket_types (event_id, state);

create index ticket_purchase_requests_buyer_idx
  on ticket_purchase_requests (buyer_user_id, created_at desc);

create index ticket_entitlements_holder_idx
  on ticket_entitlements (holder_user_id, created_at desc);

create index ticket_entitlements_event_idx
  on ticket_entitlements (event_id, state, created_at desc);

create index ticket_requests_requester_idx
  on ticket_requests (requester_user_id, created_at desc);

create policy events_select_public_owner_or_staff
  on events for select to authenticated
  using (
    state = 'published'
    or creator_user_id = private.current_app_user_id()
    or private.is_staff_member()
  );

create policy ticket_types_select_public_owner_holder_or_staff
  on ticket_types for select to authenticated
  using (
    exists (
      select 1
      from events e
      where e.id = ticket_types.event_id
        and (
          e.state = 'published'
          or e.creator_user_id = private.current_app_user_id()
          or private.is_staff_member()
        )
    )
  );

create policy ticket_purchase_requests_select_self_creator_or_staff
  on ticket_purchase_requests for select to authenticated
  using (
    buyer_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_purchase_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy ticket_entitlements_select_self_creator_or_staff
  on ticket_entitlements for select to authenticated
  using (
    holder_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_entitlements.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy ticket_requests_select_self_creator_or_staff
  on ticket_requests for select to authenticated
  using (
    requester_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );
