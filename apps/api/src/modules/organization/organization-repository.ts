import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql, type PostgresTransaction } from "../../shared/postgres.js";
import type {
  OrganizationDashboard,
  OrganizationDashboardPage,
  OrganizationMemberResource,
  OrganizationRepository
} from "./types.js";

export class OrganizationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "OrganizationRepositoryConfigurationError";
  }
}

export class OrganizationIdempotencyConflictError extends Error {
  constructor() { super("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"); this.name = "OrganizationIdempotencyConflictError"; }
}

export class OrganizationStateConflictError extends Error {
  constructor(message: string) { super(message); this.name = "OrganizationStateConflictError"; }
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

interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  role: OrganizationMemberResource["role"];
  state: OrganizationMemberResource["state"];
  invited_by_user_id: string | null;
  joined_at: Date | null;
  created_at: Date;
  is_current_user: boolean;
}

type OrganizationKybState = NonNullable<OrganizationDashboard["organization"]["kybState"]> | null;

export function createPostgresOrganizationRepository(database?: string | PostgresSql): OrganizationRepository {
  if (!database) {
    return {
      async listMyDashboards() {
        throw new OrganizationRepositoryConfigurationError();
      },
      async listMembers() { throw new OrganizationRepositoryConfigurationError(); },
      async inviteMember() { throw new OrganizationRepositoryConfigurationError(); },
      async respondToMembership() { throw new OrganizationRepositoryConfigurationError(); },
      async updateMember() { throw new OrganizationRepositoryConfigurationError(); }
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
    async listMembers(input) {
      const authorized = await sql<Array<{ allowed: boolean }>>`
        select exists (
          select 1
          from organization_memberships membership
          join users actor on actor.id = membership.user_id
          where actor.supabase_user_id = ${input.supabaseUserId}
            and membership.organization_id = ${input.organizationId}
            and membership.state = 'active'
        ) as allowed
      `;
      if (authorized[0]?.allowed !== true) return null;
      return mapOrganizationMembers(await selectOrganizationMembers(sql, input.organizationId, input.supabaseUserId));
    },
    async inviteMember(input) {
      const rows = await sql.begin(async (tx): Promise<OrganizationMemberRow[]> => {
        const parties = await tx<Array<{ actor_id: string; target_id: string }>>`
          select actor.id as actor_id, target.id as target_id
          from users actor
          join organization_memberships actor_membership
            on actor_membership.user_id = actor.id
            and actor_membership.organization_id = ${input.organizationId}
          join organizations organization on organization.id = actor_membership.organization_id
          join profiles target_profile on lower(target_profile.handle) = lower(${input.handle})
          join users target on target.id = target_profile.user_id and target.state = 'active'
          where actor.supabase_user_id = ${input.supabaseUserId}
            and actor_membership.state = 'active'
            and actor_membership.role in ('owner', 'admin')
            and organization.state = 'active'
            and exists (
              select 1 from tier_waivers entitlement
              where entitlement.subject_type = 'organization'
                and entitlement.subject_id = organization.id
                and entitlement.tier_key = 'enterprise'
                and entitlement.state = 'active'
                and entitlement.starts_at <= now()
                and (entitlement.ends_at is null or entitlement.ends_at > now())
            )
          limit 1
        `;
        const party = parties[0];
        if (!party || party.actor_id === party.target_id) return [];
        const replayMembershipId = await findOrganizationReceipt(
          tx, party.actor_id, "organization_member_invite", input.idempotencyKey, input.requestHash
        );
        if (replayMembershipId) {
          return selectOrganizationMemberById(tx, replayMembershipId, input.supabaseUserId);
        }
        const existing = await tx<Array<{ id: string; state: string }>>`
          select id, state from organization_memberships
          where organization_id = ${input.organizationId} and user_id = ${party.target_id}
          for update
        `;
        if (existing[0] && existing[0].state !== "removed") {
          throw new OrganizationStateConflictError("User already has an active or pending organization membership");
        }
        const membershipRows = await tx<Array<{ id: string }>>`
          insert into organization_memberships (
            id, organization_id, user_id, role, state, invited_by_user_id, joined_at
          ) values (
            ${existing[0]?.id ?? randomUUID()}, ${input.organizationId}, ${party.target_id},
            ${input.role}, 'invited', ${party.actor_id}, null
          )
          on conflict (organization_id, user_id)
          do update set role = excluded.role, state = 'invited', invited_by_user_id = excluded.invited_by_user_id,
            joined_at = null, updated_at = now()
          returning id
        `;
        const membershipId = membershipRows[0]?.id;
        if (!membershipId) return [];
        await tx`
          insert into notifications (
            id, user_id, kind, title, body, action_url, related_resource_type, related_resource_id, idempotency_key
          ) values (
            ${randomUUID()}, ${party.target_id}, 'studio_setup', 'Enterprise team invitation',
            'Review the organization and assigned role before accepting.', '/app/enterprise',
            'organization_membership', ${membershipId}, ${`organization-membership:${membershipId}`}
          )
          on conflict (user_id, idempotency_key) do update set state = 'unread', created_at = now()
        `;
        await recordOrganizationAudit(tx, {
          actorUserId: party.actor_id,
          membershipId,
          action: "organization_member.invited",
          idempotencyKey: input.idempotencyKey,
          metadata: { organizationId: input.organizationId, targetUserId: party.target_id, role: input.role }
        });
        await recordOrganizationReceipt(tx, {
          actorUserId: party.actor_id,
          organizationId: input.organizationId,
          membershipId,
          action: "organization_member_invite",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectOrganizationMemberById(tx, membershipId, input.supabaseUserId);
      });
      return rows[0] ? mapOrganizationMember(rows[0]) : null;
    },
    async respondToMembership(input) {
      const rows = await sql.begin(async (tx): Promise<OrganizationMemberRow[]> => {
        const memberships = await tx<Array<{ id: string; organization_id: string; user_id: string; state: string }>>`
          select membership.id, membership.organization_id, membership.user_id, membership.state
          from organization_memberships membership
          join users actor on actor.id = membership.user_id
          where membership.id = ${input.membershipId}
            and actor.supabase_user_id = ${input.supabaseUserId}
          for update of membership
        `;
        const membership = memberships[0];
        if (!membership) return [];
        const replayMembershipId = await findOrganizationReceipt(
          tx, membership.user_id, "organization_member_response", input.idempotencyKey, input.requestHash
        );
        if (replayMembershipId) return selectOrganizationMemberById(tx, replayMembershipId, input.supabaseUserId);
        const finalState = input.decision === "accept" ? "active" : "removed";
        if (membership.state !== "invited" && membership.state !== finalState) {
          throw new OrganizationStateConflictError("Organization invitation is no longer actionable");
        }
        await tx`
          update organization_memberships
          set state = ${finalState}, joined_at = case when ${finalState} = 'active' then coalesce(joined_at, now()) else null end,
            updated_at = now()
          where id = ${membership.id}
        `;
        await recordOrganizationAudit(tx, {
          actorUserId: membership.user_id,
          membershipId: membership.id,
          action: "organization_member.responded",
          idempotencyKey: input.idempotencyKey,
          metadata: { organizationId: membership.organization_id, decision: input.decision, membershipState: finalState }
        });
        await recordOrganizationReceipt(tx, {
          actorUserId: membership.user_id,
          organizationId: membership.organization_id,
          membershipId: membership.id,
          action: "organization_member_response",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectOrganizationMemberById(tx, membership.id, input.supabaseUserId);
      });
      return rows[0] ? mapOrganizationMember(rows[0]) : null;
    },
    async updateMember(input) {
      const rows = await sql.begin(async (tx): Promise<OrganizationMemberRow[]> => {
        const actors = await tx<Array<{ actor_id: string }>>`
          select actor.id as actor_id
          from users actor
          join organization_memberships membership on membership.user_id = actor.id
          where actor.supabase_user_id = ${input.supabaseUserId}
            and membership.organization_id = ${input.organizationId}
            and membership.state = 'active'
            and membership.role = 'owner'
          limit 1
        `;
        const actor = actors[0];
        if (!actor) return [];
        const replayMembershipId = await findOrganizationReceipt(
          tx, actor.actor_id, "organization_member_update", input.idempotencyKey, input.requestHash
        );
        if (replayMembershipId) return selectOrganizationMemberById(tx, replayMembershipId, input.supabaseUserId);
        const targets = await tx<Array<{ id: string; role: string; user_id: string }>>`
          select id, role, user_id from organization_memberships
          where id = ${input.membershipId} and organization_id = ${input.organizationId}
          for update
        `;
        const target = targets[0];
        if (!target || target.role === "owner" || target.user_id === actor.actor_id) {
          throw new OrganizationStateConflictError("Owner membership cannot be changed through team-role controls");
        }
        await tx`
          update organization_memberships
          set role = ${input.role}, state = ${input.state},
            joined_at = case when ${input.state} = 'active' then coalesce(joined_at, now()) else joined_at end,
            updated_at = now()
          where id = ${target.id}
        `;
        await recordOrganizationAudit(tx, {
          actorUserId: actor.actor_id,
          membershipId: target.id,
          action: "organization_member.updated",
          idempotencyKey: input.idempotencyKey,
          metadata: {
            organizationId: input.organizationId,
            previousRole: target.role,
            role: input.role,
            state: input.state
          }
        });
        await recordOrganizationReceipt(tx, {
          actorUserId: actor.actor_id,
          organizationId: input.organizationId,
          membershipId: target.id,
          action: "organization_member_update",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectOrganizationMemberById(tx, target.id, input.supabaseUserId);
      });
      return rows[0] ? mapOrganizationMember(rows[0]) : null;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

function selectOrganizationMembers(
  sql: PostgresSql,
  organizationId: string,
  supabaseUserId: string
): Promise<OrganizationMemberRow[]> {
  return sql<OrganizationMemberRow[]>`
    select membership.id, membership.organization_id, membership.user_id,
      profile.handle, profile.display_name, membership.role, membership.state,
      membership.invited_by_user_id, membership.joined_at, membership.created_at,
      (actor.id = membership.user_id) as is_current_user
    from organization_memberships membership
    join users member_user on member_user.id = membership.user_id
    join profiles profile on profile.user_id = member_user.id
    join users actor on actor.supabase_user_id = ${supabaseUserId}
    where membership.organization_id = ${organizationId}
    order by case membership.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end,
      membership.created_at
  `;
}

function selectOrganizationMemberById(
  tx: PostgresTransaction,
  membershipId: string,
  supabaseUserId: string
): Promise<OrganizationMemberRow[]> {
  return tx<OrganizationMemberRow[]>`
    select membership.id, membership.organization_id, membership.user_id,
      profile.handle, profile.display_name, membership.role, membership.state,
      membership.invited_by_user_id, membership.joined_at, membership.created_at,
      (actor.id = membership.user_id) as is_current_user
    from organization_memberships membership
    join users member_user on member_user.id = membership.user_id
    join profiles profile on profile.user_id = member_user.id
    join users actor on actor.supabase_user_id = ${supabaseUserId}
    where membership.id = ${membershipId}
    limit 1
  `;
}

type OrganizationAction =
  | "organization_member_invite"
  | "organization_member_response"
  | "organization_member_update";

async function findOrganizationReceipt(
  tx: PostgresTransaction,
  actorUserId: string,
  action: OrganizationAction,
  idempotencyKey: string,
  requestHash: string
): Promise<string | null> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`enterprise-action:${actorUserId}:${action}:${idempotencyKey}`}, 0))`;
  const rows = await tx<Array<{ request_hash: string; membership_id: string | null }>>`
    select request_hash, membership_id
    from enterprise_action_receipts
    where actor_user_id = ${actorUserId}
      and action = ${action}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const receipt = rows[0];
  if (!receipt) return null;
  if (receipt.request_hash !== requestHash) throw new OrganizationIdempotencyConflictError();
  return receipt.membership_id;
}

async function recordOrganizationReceipt(tx: PostgresTransaction, input: {
  actorUserId: string;
  organizationId: string;
  membershipId: string;
  action: OrganizationAction;
  idempotencyKey: string;
  requestHash: string;
}): Promise<void> {
  await tx`
    insert into enterprise_action_receipts (
      actor_user_id, organization_id, membership_id, action, idempotency_key, request_hash
    ) values (
      ${input.actorUserId}, ${input.organizationId}, ${input.membershipId},
      ${input.action}, ${input.idempotencyKey}, ${input.requestHash}
    )
    on conflict (actor_user_id, action, idempotency_key) do nothing
  `;
}

async function recordOrganizationAudit(tx: PostgresTransaction, input: {
  actorUserId: string;
  membershipId: string;
  action: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await tx`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
    ) values (
      ${randomUUID()}, ${input.actorUserId}, 'organization_membership', ${input.membershipId},
      ${input.action}, ${JSON.stringify(input.metadata)}::jsonb, ${input.idempotencyKey}
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
      do nothing
  `;
}

function mapOrganizationMembers(rows: OrganizationMemberRow[]): OrganizationMemberResource[] {
  return rows.map(mapOrganizationMember);
}

function mapOrganizationMember(row: OrganizationMemberRow): OrganizationMemberResource {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    state: row.state,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    isCurrentUser: row.is_current_user
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
