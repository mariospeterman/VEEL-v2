import type postgres from "postgres";
import { isStaffRole, permissionsForRoles, type StaffRole } from "./admin-permissions.js";
import type { AdminStaffAccess } from "./types.js";

type StaffIdentity =
  | { userId: string }
  | { supabaseUserId: string };

export async function resolveActiveStaffAccess(
  sql: postgres.Sql,
  identity: StaffIdentity
): Promise<AdminStaffAccess | null> {
  const identityPredicate = "userId" in identity
    ? sql`u.id = ${identity.userId}::uuid`
    : sql`u.supabase_user_id = ${identity.supabaseUserId}`;
  const rows = await sql<{ user_id: string; roles: string[]; permissions: string[] }[]>`
    select
      u.id as user_id,
      coalesce(array_agg(distinct sm.role::text) filter (where sm.role is not null), array[]::text[]) as roles,
      coalesce(array_agg(distinct sp.permission_key) filter (
        where sp.permission_key is not null and sp.revoked_at is null
      ), array[]::text[]) as permissions
    from users u
    join staff_memberships sm
      on sm.user_id = u.id and sm.state = 'active'
    left join staff_permissions sp on sp.user_id = u.id and sp.scope = 'global'
    where ${identityPredicate}
      and u.state = 'active'
    group by u.id
  `;
  const row = rows[0];
  if (!row) return null;
  const roles = row.roles.filter(isStaffRole) as StaffRole[];
  if (roles.length === 0) return null;
  return {
    userId: row.user_id,
    roles: [...roles].sort(),
    permissions: permissionsForRoles(roles, row.permissions)
  };
}
