-- Release convergence: permission-level staff authorization and namespace-bound staging fixtures.

alter type staff_role add value if not exists 'compliance';

alter table staff_memberships
  add constraint staff_memberships_state_check
  check (state in ('invited', 'active', 'suspended', 'revoked')) not valid;

alter table staff_memberships validate constraint staff_memberships_state_check;

create table staff_invitations (
  id uuid primary key,
  target_user_id uuid not null references users(id),
  role staff_role not null,
  state text not null default 'pending'
    check (state in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  invited_by_user_id uuid not null references users(id),
  expires_at timestamptz not null,
  responded_at timestamptz,
  idempotency_key text not null,
  request_hash text not null,
  response_idempotency_key text,
  response_request_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  unique (invited_by_user_id, idempotency_key)
);

create unique index staff_invitations_response_idempotency_idx
  on staff_invitations (target_user_id, response_idempotency_key)
  where response_idempotency_key is not null;

create unique index staff_invitations_one_pending_role_idx
  on staff_invitations (target_user_id, role)
  where state = 'pending';

create index staff_invitations_target_state_expires_idx
  on staff_invitations (target_user_id, state, expires_at desc);

create index staff_memberships_active_owner_idx
  on staff_memberships (role, user_id)
  where state = 'active' and role = 'owner';

alter table staff_invitations enable row level security;
revoke all on table staff_invitations from anon, authenticated;

create table staff_membership_action_receipts (
  actor_user_id uuid not null references users(id),
  membership_id uuid not null references staff_memberships(id),
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key),
  check (jsonb_typeof(response) = 'object')
);

create index staff_membership_action_receipts_membership_idx
  on staff_membership_action_receipts (membership_id, created_at desc);

alter table staff_membership_action_receipts enable row level security;
revoke all on table staff_membership_action_receipts from anon, authenticated;

create table staging_fixture_resources (
  namespace text not null,
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (namespace, resource_type, resource_id),
  check (namespace ~ '^[a-z0-9][a-z0-9_-]{2,63}$')
);

create index staging_fixture_resources_created_at_idx
  on staging_fixture_resources (created_at);

alter table staging_fixture_resources enable row level security;
revoke all on table staging_fixture_resources from anon, authenticated;

comment on table staging_fixture_resources is
  'Server-only ownership ledger for exact namespace-bound non-production staging fixture cleanup.';

comment on table staff_invitations is
  'Bounded existing-user staff invitations; backend lifecycle policy owns all mutations.';
