-- Admin data request and feature flag policy surfaces.
-- Data request rows are privacy lifecycle records only. Feature flags are software
-- policy controls only and must never create payment truth, access truth, custody,
-- social priority, recommendation boost, Mutuals preference, or message priority.

create table data_requests (
  id uuid primary key,
  requester_user_id uuid not null references users(id),
  type text not null check (type in ('export', 'delete')),
  state text not null default 'requested'
    check (state in ('requested', 'verifying', 'processing', 'completed', 'rejected')),
  reason text,
  privacy_boundary text not null default 'sanitized_identity_minimized_no_raw_exports'
    check (privacy_boundary = 'sanitized_identity_minimized_no_raw_exports'),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  completed_at timestamptz
);

create table feature_flags (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  category text not null default 'feature'
    check (category in ('feature', 'provider', 'compliance', 'safety', 'admin_policy')),
  policy_boundary text not null default 'software_policy_only_no_payment_access_or_social_priority'
    check (policy_boundary = 'software_policy_only_no_payment_access_or_social_priority'),
  state text not null default 'active'
    check (state in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index data_requests_requester_created_idx
  on data_requests (requester_user_id, created_at desc);

create index data_requests_state_created_idx
  on data_requests (state, created_at desc);

create index feature_flags_category_state_idx
  on feature_flags (category, state, updated_at desc);

alter table data_requests enable row level security;
alter table feature_flags enable row level security;

grant select on table data_requests, feature_flags to authenticated;

create policy data_requests_select_self_or_staff
  on data_requests for select to authenticated
  using (requester_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy feature_flags_staff_select
  on feature_flags for select to authenticated
  using ((select private.is_staff_member()));
