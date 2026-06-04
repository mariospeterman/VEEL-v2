-- Livepeer live room, pass, chat, and replay foundation.
-- Fastify owns room creation, payment settlement grants, chat writes, and provider status projection.

create table live_rooms (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  title text not null,
  provider text not null default 'livepeer',
  provider_stream_id text unique not null,
  provider_playback_id text,
  provider_state text not null default 'created',
  state text not null default 'waiting',
  access_rule text not null default 'pass_required',
  teaser_seconds integer not null default 60,
  pass_price_minor bigint not null default 50000000,
  currency text not null default 'SOL',
  pass_durations_minutes integer[] not null default array[30, 60, 180],
  host_ingest_url text,
  host_stream_key text,
  playback_url text,
  playback_jwt_required boolean not null default true,
  replay_content_item_id uuid references content_items(id),
  idempotency_key text not null,
  request_hash text not null,
  starts_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (teaser_seconds >= 0 and teaser_seconds <= 300),
  check (pass_price_minor > 0),
  check (provider = 'livepeer'),
  unique (creator_user_id, idempotency_key)
);

create table live_pass_purchase_requests (
  payment_intent_id uuid primary key references payment_intents(id),
  room_id uuid not null references live_rooms(id),
  buyer_user_id uuid not null references users(id),
  duration_minutes integer not null,
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  check (duration_minutes in (30, 60, 180))
);

create table live_passes (
  id uuid primary key,
  room_id uuid not null references live_rooms(id),
  user_id uuid not null references users(id),
  payment_intent_id uuid unique not null references payment_intents(id),
  duration_minutes integer not null,
  state text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (duration_minutes in (30, 60, 180))
);

create table live_chat_messages (
  id uuid primary key,
  room_id uuid not null references live_rooms(id),
  user_id uuid not null references users(id),
  body text not null,
  state text not null default 'visible',
  created_at timestamptz not null default now(),
  check (char_length(body) between 1 and 500)
);

create table live_replay_assets (
  id uuid primary key,
  room_id uuid not null references live_rooms(id),
  content_item_id uuid references content_items(id),
  provider_asset_id text,
  provider_playback_id text,
  state text not null default 'processing',
  playback_url text,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, provider_asset_id)
);

alter table live_rooms enable row level security;
alter table live_pass_purchase_requests enable row level security;
alter table live_passes enable row level security;
alter table live_chat_messages enable row level security;
alter table live_replay_assets enable row level security;

create index live_rooms_creator_created_at_idx
  on live_rooms (creator_user_id, created_at desc);

create index live_rooms_state_created_at_idx
  on live_rooms (state, created_at desc);

create index live_passes_user_room_state_idx
  on live_passes (user_id, room_id, state, expires_at desc);

create index live_chat_messages_room_created_at_idx
  on live_chat_messages (room_id, created_at desc);

create index live_replay_assets_room_state_idx
  on live_replay_assets (room_id, state, ready_at desc);
