-- Admin support case and organization support policy surface.
-- Support priority is a software support SLA only. It must never grant people access,
-- visibility, recommendations, Mutuals treatment, message priority, custody, or payouts.

create table support_cases (
  id uuid primary key,
  organization_id uuid references organizations(id),
  requester_user_id uuid references users(id),
  assigned_staff_user_id uuid references users(id),
  subject_type text not null default 'none'
    check (subject_type in ('content', 'event', 'payment', 'provider', 'support_case', 'report', 'user', 'organization', 'none')),
  subject_id uuid,
  category text not null
    check (category in ('account', 'payment', 'access', 'safety', 'compliance', 'organization', 'technical')),
  state text not null default 'open'
    check (state in ('open', 'pending_user', 'pending_internal', 'resolved', 'closed')),
  priority text not null default 'standard'
    check (priority in ('standard', 'priority', 'enterprise_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  closed_at timestamptz
);

create table organization_support_policies (
  id uuid primary key,
  organization_id uuid not null references organizations(id) unique,
  support_state text not null default 'standard'
    check (support_state in ('standard', 'priority', 'enterprise_review')),
  sla_tier text not null default 'standard'
    check (sla_tier in ('standard', 'priority', 'enterprise_review')),
  state text not null default 'review_required'
    check (state in ('active', 'paused', 'review_required')),
  policy_reason text,
  money_boundary text not null default 'software_sla_only_no_social_priority'
    check (money_boundary = 'software_sla_only_no_social_priority'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_cases_state_created_idx
  on support_cases (state, priority, created_at desc);

create index support_cases_org_state_idx
  on support_cases (organization_id, state, created_at desc)
  where organization_id is not null;

create index support_cases_subject_idx
  on support_cases (subject_type, subject_id)
  where subject_id is not null;

create index organization_support_policies_state_idx
  on organization_support_policies (state, support_state, updated_at desc);

alter table support_cases enable row level security;
alter table organization_support_policies enable row level security;

grant select on table support_cases, organization_support_policies to authenticated;

create policy support_cases_staff_select
  on support_cases for select to authenticated
  using ((select private.is_staff_member()));

create policy organization_support_policies_staff_select
  on organization_support_policies for select to authenticated
  using ((select private.is_staff_member()));
