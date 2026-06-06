drop policy if exists organizations_member_select on organizations;
drop policy if exists organization_memberships_select_self_or_staff on organization_memberships;

revoke select on table organization_memberships from authenticated;

drop index if exists organization_memberships_org_state_idx;
drop index if exists organization_memberships_user_state_idx;

drop table if exists organization_memberships;
