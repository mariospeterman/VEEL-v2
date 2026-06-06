drop policy if exists organizations_select_member_or_staff on organizations;

create policy organizations_staff_select
  on organizations for select to authenticated
  using ((select private.is_staff_member()));

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

drop index if exists organization_memberships_invited_by_user_idx;
