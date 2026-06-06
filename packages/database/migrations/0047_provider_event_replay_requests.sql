-- Provider event replay requests are admin/worker state.
-- They enqueue a replay attempt and audit intent; they do not mark provider truth
-- as replayed until a worker adapter records the outcome.

create table provider_event_replay_requests (
  id uuid primary key,
  provider_event_id uuid not null references provider_events(id) on delete cascade,
  requested_by_user_id uuid references users(id),
  idempotency_key text not null,
  reason text not null,
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'replayed', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  leased_at timestamptz,
  processed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_event_id, idempotency_key)
);

create index provider_event_replay_requests_state_created_idx
  on provider_event_replay_requests (state, created_at asc);

create index provider_event_replay_requests_provider_event_idx
  on provider_event_replay_requests (provider_event_id, created_at desc);

alter table provider_event_replay_requests enable row level security;

create policy provider_event_replay_requests_staff_select
  on provider_event_replay_requests for select
  to authenticated
  using ((select private.is_staff_member()));
