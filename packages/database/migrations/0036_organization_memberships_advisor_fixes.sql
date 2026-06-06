-- Supabase advisor fixes for organization membership RLS and foreign-key performance.

create index organization_memberships_invited_by_user_idx
  on organization_memberships (invited_by_user_id)
  where invited_by_user_id is not null;

drop policy if exists organizations_member_select on organizations;
drop policy if exists organizations_staff_select on organizations;

create policy organizations_select_member_or_staff
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
