-- Studio and Enterprise organization membership read model.
-- Organization dashboards are software/governance surfaces, not payout or custody surfaces.

create table organization_memberships (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  state text not null default 'active' check (state in ('invited', 'active', 'suspended', 'removed')),
  invited_by_user_id uuid references users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_memberships_user_state_idx
  on organization_memberships (user_id, state, created_at desc);

create index organization_memberships_org_state_idx
  on organization_memberships (organization_id, state, created_at desc);

alter table organization_memberships enable row level security;

grant select on table organization_memberships to authenticated;

create policy organization_memberships_select_self_or_staff
  on organization_memberships for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy organizations_member_select
  on organizations for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from organization_memberships om
      where om.organization_id = organizations.id
        and om.user_id = (select private.current_app_user_id())
        and om.state = 'active'
    )
  );
