drop policy if exists organization_support_policies_staff_select on organization_support_policies;
drop policy if exists support_cases_staff_select on support_cases;

revoke select on table organization_support_policies from authenticated;
revoke select on table support_cases from authenticated;

drop index if exists organization_support_policies_state_idx;
drop index if exists support_cases_subject_idx;
drop index if exists support_cases_org_state_idx;
drop index if exists support_cases_state_created_idx;

drop table if exists organization_support_policies;
drop table if exists support_cases;
