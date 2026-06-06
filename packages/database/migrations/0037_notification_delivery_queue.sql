-- Notification delivery queue and server-only encrypted push subscription material.
-- Delivery attempts are worker/admin service state; clients never read raw endpoints or keys.

alter table notification_devices
  add column endpoint_ciphertext text,
  add column endpoint_iv text,
  add column endpoint_tag text,
  add column p256dh_ciphertext text,
  add column p256dh_iv text,
  add column p256dh_tag text,
  add column auth_ciphertext text,
  add column auth_iv text,
  add column auth_tag text;

create type notification_delivery_state as enum (
  'queued',
  'leased',
  'delivered',
  'failed',
  'skipped',
  'revoked'
);

create table notification_delivery_attempts (
  id uuid primary key,
  notification_id uuid not null references notifications(id),
  device_id uuid not null references notification_devices(id),
  user_id uuid not null references users(id),
  provider notification_device_provider not null,
  state notification_delivery_state not null default 'queued',
  failure_code text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, device_id)
);

create index notification_delivery_attempts_state_next_idx
  on notification_delivery_attempts (state, next_attempt_at, created_at);

create index notification_delivery_attempts_user_state_idx
  on notification_delivery_attempts (user_id, state, created_at desc);

create index notification_delivery_attempts_notification_idx
  on notification_delivery_attempts (notification_id);

alter table notification_delivery_attempts enable row level security;
