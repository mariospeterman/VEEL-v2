import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
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
  verification_kyb_status: "valid" | "invalid" | "pending" | "expired" | "revoked" | "blocked" | null;
  role: OrganizationDashboard["organization"]["role"];
  membership_state: OrganizationDashboard["organization"]["membershipState"];
  created_at: Date;
  joined_at: Date | null;
  member_count: number;
  active_member_count: number;
  tier_waiver_state: OrganizationDashboard["governance"]["tierWaiverState"] | null;
  has_enterprise_entitlement: boolean;
}

type OrganizationKybState = NonNullable<OrganizationDashboard["organization"]["kybState"]> | null;

export function createPostgresOrganizationRepository(database?: string | PostgresSql): OrganizationRepository {
  if (!database) {
    return {
      async listMyDashboards() {
        throw new OrganizationRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

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
        ),
        active_enterprise_entitlements as (
          select distinct subject_id as organization_id
          from tier_waivers
          where subject_type = 'organization'
            and tier_key = 'enterprise'
            and state = 'active'
            and starts_at <= now()
            and (ends_at is null or ends_at > now())
        ),
        latest_org_kyb as (
          select distinct on (subject_id)
            subject_id as organization_id,
            case
              when status = 'valid' and expires_at is not null and expires_at <= now() then 'expired'
              else status
            end as verification_kyb_status
          from verification_records
          where subject_type = 'organization'
            and purpose = 'org_kyb'
          order by subject_id,
            case when status = 'valid' and (expires_at is null or expires_at > now()) then 0 else 1 end,
            verified_at desc nulls last,
            created_at desc
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
          atw.tier_waiver_state,
          (aee.organization_id is not null) as has_enterprise_entitlement,
          lok.verification_kyb_status
        from organization_memberships om
        join target_user tu on tu.id = om.user_id
        join organizations o on o.id = om.organization_id
        left join member_counts mc on mc.organization_id = o.id
        left join active_tier_waivers atw on atw.organization_id = o.id
        left join active_enterprise_entitlements aee on aee.organization_id = o.id
        left join latest_org_kyb lok on lok.organization_id = o.id
        where om.state in ('active', 'invited')
          and (${input.cursor ?? null}::timestamptz is null or o.created_at < ${input.cursor ?? null}::timestamptz)
        order by o.created_at desc
        limit ${input.limit + 1}
      `;

      return toDashboardPage(rows, input.limit);
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
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
  const kybState = kybStateFromVerification(row.verification_kyb_status, row.kyb_state);
  const organizationActive = row.state === "active";
  const enterpriseActive = organizationActive && row.has_enterprise_entitlement;
  const notices: OrganizationDashboard["notices"] = [];

  if (kybState !== "verified") {
    notices.push({
      kind: "kyb_required",
      title: "KYB review required",
      state: kybState === "rejected" ? "open" : "pending"
    });
  }

  if (!row.has_enterprise_entitlement) {
    notices.push({
      kind: "compliance_review",
      title: "Enterprise entitlement required",
      state: "open"
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
      supportState: enterpriseActive ? "priority" : "enterprise_review"
    },
    capabilities: {
      rbacEnabled: enterpriseActive,
      teamPublishingEnabled: enterpriseActive && kybState === "verified",
      consolidatedReportingEnabled: enterpriseActive,
      complianceExportsEnabled: enterpriseActive && kybState === "verified"
    },
    rolePermissions: rolePermissions(row, kybState),
    financeBoundary: "no_custody_no_payout_queue",
    notices
  };
}

function kybStateFromVerification(
  verificationStatus: OrganizationDashboardRow["verification_kyb_status"],
  legacyKybState: OrganizationDashboardRow["kyb_state"]
): OrganizationKybState {
  if (verificationStatus === "valid") {
    return "verified";
  }

  if (verificationStatus === "pending") {
    return "pending";
  }

  if (verificationStatus === "blocked" || verificationStatus === "revoked") {
    return "rejected";
  }

  if (verificationStatus === "expired" || verificationStatus === "invalid") {
    return "not_started";
  }

  return legacyKybState === undefined ? null : legacyKybState;
}

function rolePermissions(
  row: OrganizationDashboardRow,
  kybState: OrganizationKybState
): OrganizationDashboard["rolePermissions"] {
  return [
    permission(row, kybState, {
      key: "manage_members",
      label: "Manage members",
      roles: ["owner", "admin"],
      requiresEnterprise: true
    }),
    permission(row, kybState, {
      key: "publish_team_content",
      label: "Publish team content",
      roles: ["owner", "admin", "member"],
      requiresEnterprise: true,
      requiresKyb: true
    }),
    permission(row, kybState, {
      key: "view_consolidated_reporting",
      label: "View consolidated reporting",
      roles: ["owner", "admin", "member", "viewer"],
      requiresEnterprise: true
    }),
    permission(row, kybState, {
      key: "export_compliance",
      label: "Export compliance",
      roles: ["owner", "admin"],
      requiresEnterprise: true,
      requiresKyb: true
    }),
    permission(row, kybState, {
      key: "manage_support",
      label: "Manage support",
      roles: ["owner", "admin"],
      requiresEnterprise: true
    })
  ];
}

function permission(
  row: OrganizationDashboardRow,
  kybState: OrganizationKybState,
  policy: {
    key: OrganizationDashboard["rolePermissions"][number]["key"];
    label: string;
    roles: OrganizationDashboard["organization"]["role"][];
    requiresEnterprise?: boolean;
    requiresKyb?: boolean;
  }
): OrganizationDashboard["rolePermissions"][number] {
  const reason =
    row.membership_state !== "active"
      ? "membership_not_active"
      : row.state !== "active"
        ? "organization_not_active"
        : policy.requiresEnterprise && !row.has_enterprise_entitlement
          ? "enterprise_entitlement_required"
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
