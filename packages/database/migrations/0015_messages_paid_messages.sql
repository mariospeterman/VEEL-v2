-- Messages and paid-message delivery foundation.
-- Backend writes messages; confirmed settlement is required before paid message delivery.

create table conversations (
  id uuid primary key,
  type text not null default 'direct',
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type in ('direct', 'match', 'paid')),
  check (state in ('active', 'archived'))
);

create table conversation_members (
  conversation_id uuid not null references conversations(id),
  user_id uuid not null references users(id),
  role text not null default 'member',
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  check (role in ('member', 'creator', 'support'))
);

create table messages (
  id uuid primary key,
  conversation_id uuid not null references conversations(id),
  sender_user_id uuid not null references users(id),
  body text not null,
  delivery_state text not null default 'visible',
  payment_intent_id uuid unique references payment_intents(id),
  created_at timestamptz not null default now(),
  check (char_length(body) between 1 and 4000),
  check (delivery_state in ('visible', 'pending_payment', 'hidden'))
);

create table paid_message_delivery_requests (
  payment_intent_id uuid primary key references payment_intents(id),
  conversation_id uuid not null references conversations(id),
  sender_user_id uuid not null references users(id),
  recipient_user_id uuid not null references users(id),
  body text not null,
  amount_minor bigint not null,
  currency text not null default 'SOL',
  state text not null default 'pending_payment',
  message_id uuid unique references messages(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  check (char_length(body) between 1 and 4000),
  check (state in ('pending_payment', 'delivered', 'cancelled'))
);

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table paid_message_delivery_requests enable row level security;

create index conversation_members_user_idx
  on conversation_members (user_id, conversation_id);

create index messages_conversation_created_at_idx
  on messages (conversation_id, created_at desc);

create index paid_message_delivery_requests_conversation_idx
  on paid_message_delivery_requests (conversation_id, state, created_at desc);

create index paid_message_delivery_requests_sender_idx
  on paid_message_delivery_requests (sender_user_id, state, created_at desc);
