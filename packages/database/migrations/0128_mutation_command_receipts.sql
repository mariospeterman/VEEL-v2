-- Persist lifelong, response-bearing idempotency for admin and profile commands.
-- The request body is represented only by a SHA-256 digest; no raw mutation payload is retained.

create table mutation_command_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references users(id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  target_id text not null check (char_length(target_id) between 1 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_version integer not null check (request_version > 0),
  request_body_hash text not null check (request_body_hash ~ '^[a-f0-9]{64}$'),
  response_status integer not null check (response_status between 100 and 599),
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, action, idempotency_key)
);

alter table mutation_command_receipts enable row level security;
revoke all on table mutation_command_receipts from public, anon, authenticated;

comment on table mutation_command_receipts is
  'Server-only lifelong idempotency receipts scoped by actor, action and key. Target, request schema version, body hash and original response are immutable replay authority.';
comment on column mutation_command_receipts.request_body_hash is
  'SHA-256 of the stable JSON mutation body; raw request bodies and secrets are never stored here.';

