import postgres from "postgres";
import type { OrganizationDashboard, OrganizationDashboardPage, OrganizationRepository } from "./types.js";

export class OrganizationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "OrganizationRepositoryConfigurationError";
  }
}

interface OrganizationDashboardRow {
  membership_id: string;
  organization_id: string;
  name: string;
  state: OrganizationDashboard["organization"]["state"];
  plan: OrganizationDashboard["organization"]["plan"];
  kyb_state: OrganizationDashboard["organization"]["kybState"];
  role: OrganizationDashboard["organization"]["role"];
  membership_state: OrganizationDashboard["organization"]["membershipState"];
  created_at: Date;
  joined_at: Date | null;
  member_count: number;
  active_member_count: number;
  tier_waiver_state: OrganizationDashboard["governance"]["tierWaiverState"] | null;
}

export function createPostgresOrganizationRepository(databaseUrl?: string): OrganizationRepository {
  if (!databaseUrl) {
    return {
      async listMyDashboards() {
        throw new OrganizationRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listMyDashboards(input) {
      const rows = await sql<OrganizationDashboardRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        member_counts as (
          select
            organization_id,
            count(*)::int as member_count,
            count(*) filter (where state = 'active')::int as active_member_count
          from organization_memberships
          group by organization_id
        ),
        active_tier_waivers as (
          select distinct on (subject_id)
            subject_id as organization_id,
            state as tier_waiver_state
          from tier_waivers
          where subject_type = 'organization'
          order by subject_id, starts_at desc
        )
        select
          om.id as membership_id,
          o.id as organization_id,
          o.name,
          o.state,
          o.plan,
          o.kyb_state,
          om.role,
          om.state as membership_state,
          o.created_at,
          om.joined_at,
          coalesce(mc.member_count, 0) as member_count,
          coalesce(mc.active_member_count, 0) as active_member_count,
          atw.tier_waiver_state
        from organization_memberships om
        join target_user tu on tu.id = om.user_id
        join organizations o on o.id = om.organization_id
        left join member_counts mc on mc.organization_id = o.id
        left join active_tier_waivers atw on atw.organization_id = o.id
        where om.state in ('active', 'invited')
          and (${input.cursor ?? null}::timestamptz is null or o.created_at < ${input.cursor ?? null}::timestamptz)
        order by o.created_at desc
        limit ${input.limit + 1}
      `;

      return toDashboardPage(rows, input.limit);
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toDashboardPage(rows: OrganizationDashboardRow[], limit: number): OrganizationDashboardPage {
  const visibleRows = rows.slice(0, limit);
  const extraRow = rows[limit];

  return {
    items: visibleRows.map(toDashboard),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}

function toDashboard(row: OrganizationDashboardRow): OrganizationDashboard {
  const kybState = row.kyb_state ?? null;
  const notices: OrganizationDashboard["notices"] = [];

  if (kybState !== "verified") {
    notices.push({
      kind: "kyb_required",
      title: "KYB review required",
      state: kybState === "rejected" ? "open" : "pending"
    });
  }

  if (row.membership_state === "invited") {
    notices.push({
      kind: "member_invite",
      title: "Membership invite pending",
      state: "pending"
    });
  }

  return {
    organization: {
      id: row.membership_id,
      organizationId: row.organization_id,
      name: row.name,
      state: row.state,
      plan: row.plan,
      kybState,
      role: row.role,
      membershipState: row.membership_state,
      createdAt: row.created_at.toISOString(),
      joinedAt: row.joined_at?.toISOString() ?? null
    },
    governance: {
      kybState,
      memberCount: row.member_count,
      activeMemberCount: row.active_member_count,
      tierWaiverState: row.tier_waiver_state ?? "none",
      supportState: row.state === "active" && kybState === "verified" ? "priority" : "enterprise_review"
    },
    capabilities: {
      rbacEnabled: true,
      teamPublishingEnabled: row.state === "active",
      consolidatedReportingEnabled: row.state === "active",
      complianceExportsEnabled: row.state === "active" && kybState === "verified"
    },
    rolePermissions: rolePermissions(row, kybState),
    financeBoundary: "no_custody_no_payout_queue",
    notices
  };
}

function rolePermissions(
  row: OrganizationDashboardRow,
  kybState: OrganizationDashboard["organization"]["kybState"]
): OrganizationDashboard["rolePermissions"] {
  return [
    permission(row, kybState, {
      key: "manage_members",
      label: "Manage members",
      roles: ["owner", "admin"]
    }),
    permission(row, kybState, {
      key: "publish_team_content",
      label: "Publish team content",
      roles: ["owner", "admin", "member"]
    }),
    permission(row, kybState, {
      key: "view_consolidated_reporting",
      label: "View consolidated reporting",
      roles: ["owner", "admin", "member", "viewer"]
    }),
    permission(row, kybState, {
      key: "export_compliance",
      label: "Export compliance",
      roles: ["owner", "admin"],
      requiresKyb: true
    }),
    permission(row, kybState, {
      key: "manage_support",
      label: "Manage support",
      roles: ["owner", "admin"]
    })
  ];
}

function permission(
  row: OrganizationDashboardRow,
  kybState: OrganizationDashboard["organization"]["kybState"],
  policy: {
    key: OrganizationDashboard["rolePermissions"][number]["key"];
    label: string;
    roles: OrganizationDashboard["organization"]["role"][];
    requiresKyb?: boolean;
  }
): OrganizationDashboard["rolePermissions"][number] {
  const reason =
    row.membership_state !== "active"
      ? "membership_not_active"
      : row.state !== "active"
        ? "organization_not_active"
        : policy.requiresKyb && kybState !== "verified"
          ? "kyb_not_verified"
          : policy.roles.includes(row.role)
            ? "allowed"
            : "role_not_permitted";

  return {
    key: policy.key,
    label: policy.label,
    allowed: reason === "allowed",
    reason
  };
}
