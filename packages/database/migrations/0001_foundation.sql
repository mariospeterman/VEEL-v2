-- Veel v2 foundation database migration.
-- Backend Fastify owns all mutations for these tables in this slice.

create type staff_role as enum (
  'owner',
  'admin',
  'trust_safety',
  'support',
  'finance',
  'ops',
  'creator_success',
  'event_ops',
  'ai_ops',
  'readonly_auditor'
);

create table users (
  id uuid primary key,
  supabase_user_id uuid unique not null,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references users(id),
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  location_label text,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_memberships (
  id uuid primary key,
  user_id uuid not null references users(id),
  role staff_role not null,
  state text not null default 'active',
  granted_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table staff_permissions (
  id uuid primary key,
  user_id uuid not null references users(id),
  permission_key text not null,
  scope text not null default 'global',
  granted_by_user_id uuid references users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, permission_key, scope)
);

create table provider_events (
  id uuid primary key,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  normalized_state text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table provider_webhook_receipts (
  id uuid primary key,
  provider text not null,
  webhook_type text not null,
  signature_hash text,
  idempotency_key text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  state text not null default 'received',
  unique (provider, webhook_type, idempotency_key)
);

create table idempotency_keys (
  key text primary key,
  actor_user_id uuid references users(id),
  scope text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key,
  actor_user_id uuid references users(id),
  subject_type text not null,
  subject_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profiles_handle_idx on profiles (handle);
create index staff_memberships_user_id_idx on staff_memberships (user_id);
create index staff_permissions_user_id_idx on staff_permissions (user_id);
create index provider_events_provider_received_at_idx on provider_events (provider, received_at desc);
create index provider_webhook_receipts_provider_received_at_idx on provider_webhook_receipts (provider, received_at desc);
create index idempotency_keys_actor_user_id_idx on idempotency_keys (actor_user_id);
create index idempotency_keys_expires_at_idx on idempotency_keys (expires_at);
create index audit_events_actor_user_id_idx on audit_events (actor_user_id);
create index audit_events_subject_idx on audit_events (subject_type, subject_id);
create index audit_events_created_at_idx on audit_events (created_at desc);
