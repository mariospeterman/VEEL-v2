-- Durable queue leases prevent duplicate provider calls and recover work after worker crashes.

alter table subscription_collections
  drop constraint subscription_collections_state_check;

alter table subscription_collections
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column lease_token uuid,
  add column leased_until timestamptz,
  add column next_attempt_at timestamptz;

update subscription_collections
set
  state = case when state = 'submitted' then 'processing' else state end,
  attempt_count = case when state = 'submitted' then 1 else attempt_count end,
  lease_token = case when state = 'submitted' then gen_random_uuid() else lease_token end,
  leased_until = case when state = 'submitted' then now() else leased_until end,
  next_attempt_at = coalesce(due_at, created_at)
where next_attempt_at is null or state = 'submitted';

alter table subscription_collections
  alter column next_attempt_at set default now(),
  alter column next_attempt_at set not null,
  add constraint subscription_collections_state_check
    check (state in ('due', 'processing', 'confirmed', 'failed', 'dead_letter', 'skipped', 'cancelled'));

create index subscription_collections_lease_due_idx
  on subscription_collections (state, next_attempt_at, leased_until, created_at)
  where state in ('due', 'processing', 'failed');

alter type notification_delivery_state add value if not exists 'dead_letter';

alter table notification_delivery_attempts
  add column lease_token uuid,
  add column leased_until timestamptz;

create index notification_delivery_attempts_lease_due_idx
  on notification_delivery_attempts (state, next_attempt_at, leased_until, created_at)
  where state in ('queued', 'leased', 'failed');

alter table payment_confirmation_deliveries
  drop constraint payment_confirmation_deliveries_state_check;

alter table payment_confirmation_deliveries
  add constraint payment_confirmation_deliveries_state_check
    check (state in ('queued', 'processing', 'sent', 'provider_not_configured', 'failed', 'dead_letter')),
  add column lease_token uuid,
  add column leased_until timestamptz,
  add column next_attempt_at timestamptz not null default now();

create index payment_confirmation_deliveries_lease_due_idx
  on payment_confirmation_deliveries (state, next_attempt_at, leased_until, created_at)
  where state in ('queued', 'processing', 'provider_not_configured', 'failed');

alter table provider_event_replay_requests
  drop constraint provider_event_replay_requests_state_check;

alter table provider_event_replay_requests
  add constraint provider_event_replay_requests_state_check
    check (state in ('queued', 'processing', 'replayed', 'failed', 'dead_letter', 'cancelled')),
  add column lease_token uuid,
  add column leased_until timestamptz,
  add column next_attempt_at timestamptz not null default now();

create index provider_event_replay_requests_lease_due_idx
  on provider_event_replay_requests (state, next_attempt_at, leased_until, created_at)
  where state in ('queued', 'processing', 'failed');

create table worker_queue_recovery_requests (
  id uuid primary key,
  queue_name text not null check (
    queue_name in (
      'subscription_collections',
      'notification_deliveries',
      'payment_confirmation_emails',
      'provider_event_replays'
    )
  ),
  job_id uuid not null,
  requested_by_user_id uuid references users(id),
  idempotency_key text not null,
  reason text not null check (length(trim(reason)) between 3 and 1000),
  created_at timestamptz not null default now(),
  unique (queue_name, job_id, idempotency_key)
);

create index worker_queue_recovery_requests_created_idx
  on worker_queue_recovery_requests (created_at desc);

alter table worker_queue_recovery_requests enable row level security;
