import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { AdminRepository, AdminStaffMember, StaffInvitation } from "./types.js";
import { AdminRepositoryStateConflictError } from "./admin-repository-errors.js";

type StaffMemberRow = {
  membership_id: string;
  user_id: string;
  handle: string;
  display_name: string;
  role: AdminStaffMember["role"];
  state: AdminStaffMember["state"];
  created_at: Date | string;
};

type InvitationRow = {
  id: string;
  target_user_id: string;
  target_handle: string;
  role: StaffInvitation["role"];
  state: StaffInvitation["state"];
  invited_by_user_id: string;
  expires_at: Date | string;
  responded_at: Date | string | null;
  created_at: Date | string;
  request_hash: string;
  response_idempotency_key: string | null;
  response_request_hash: string | null;
};

const invitationSelect = `
  select
    invitation.id,
    invitation.target_user_id,
    profile.handle as target_handle,
    invitation.role,
    case
      when invitation.state = 'pending' and invitation.expires_at <= now() then 'expired'
      else invitation.state
    end as state,
    invitation.invited_by_user_id,
    invitation.expires_at,
    invitation.responded_at,
    invitation.created_at,
    invitation.request_hash,
    invitation.response_idempotency_key,
    invitation.response_request_hash
  from staff_invitations invitation
  join profiles profile on profile.user_id = invitation.target_user_id
`;

export function createStaffRepository(
  sql: postgres.Sql
): Pick<
  AdminRepository,
  "getStaffDirectory" | "inviteStaff" | "updateStaffMembership" | "listCurrentStaffInvitations" | "respondStaffInvitation"
> {
  return {
    async getStaffDirectory() {
      const [memberships, invitations] = await Promise.all([
        sql<StaffMemberRow[]>`
          select
            membership.id as membership_id,
            membership.user_id,
            profile.handle,
            profile.display_name,
            membership.role,
            membership.state,
            membership.created_at
          from staff_memberships membership
          join profiles profile on profile.user_id = membership.user_id
          order by membership.state, membership.role, lower(profile.handle)
        `,
        sql.unsafe<InvitationRow[]>(`${invitationSelect} order by invitation.created_at desc`)
      ]);
      return {
        memberships: memberships.map(toStaffMember),
        invitations: invitations.map(toInvitation)
      };
    },

    async inviteStaff(input) {
      const requestHash = hashRequest({
        targetUserId: input.targetUserId,
        role: input.role,
        expiresInHours: input.expiresInHours,
        reason: input.reason
      });
      const rows: InvitationRow[] = await sql.begin(async (transaction) => {
        const parties = await transaction<Array<{ actor_id: string; target_id: string }>>`
          select actor.id as actor_id, target.id as target_id
          from users actor
          cross join users target
          where actor.supabase_user_id = ${input.supabaseUserId}::uuid
            and actor.state = 'active'
            and target.id = ${input.targetUserId}::uuid
            and target.state = 'active'
          limit 1
        `;
        const partiesRow = parties[0];
        if (!partiesRow) return [] as InvitationRow[];
        await transaction`
          select pg_advisory_xact_lock(hashtext(${`staff_invitation:${partiesRow.actor_id}:${input.idempotencyKey}`}))
        `;
        const replay = await transaction<InvitationRow[]>`
          ${transaction.unsafe(invitationSelect)}
          where invitation.invited_by_user_id = ${partiesRow.actor_id}::uuid
            and invitation.idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (replay[0]) {
          if (replay[0].request_hash !== requestHash) {
            throw new AdminRepositoryStateConflictError("The idempotency key was already used for a different staff invitation");
          }
          return replay;
        }

        await transaction`
          select pg_advisory_xact_lock(
            hashtext(${`staff_invitation_target:${partiesRow.target_id}:${input.role}`})
          )
        `;

        await transaction`
          update staff_invitations
          set state = 'expired', updated_at = now()
          where target_user_id = ${partiesRow.target_id}::uuid
            and role = ${input.role}::staff_role
            and state = 'pending'
            and expires_at <= now()
        `;

        const conflicts = await transaction<Array<{ conflict: boolean }>>`
          select exists (
            select 1 from staff_memberships
            where user_id = ${partiesRow.target_id}::uuid
              and role = ${input.role}::staff_role
              and state in ('invited', 'active', 'suspended')
            union all
            select 1 from staff_invitations
            where target_user_id = ${partiesRow.target_id}::uuid
              and role = ${input.role}::staff_role
              and state = 'pending'
              and expires_at > now()
          ) as conflict
        `;
        if (conflicts[0]?.conflict) {
          throw new AdminRepositoryStateConflictError("That user already has this role or a pending invitation");
        }

        const inserted = await transaction<InvitationRow[]>`
          with created as (
            insert into staff_invitations (
              id, target_user_id, role, invited_by_user_id, expires_at, idempotency_key, request_hash
            ) values (
              gen_random_uuid(), ${partiesRow.target_id}::uuid, ${input.role}::staff_role,
              ${partiesRow.actor_id}::uuid, now() + (${input.expiresInHours}::text || ' hours')::interval,
              ${input.idempotencyKey}, ${requestHash}
            )
            returning *
          )
          select
            created.id, created.target_user_id, profile.handle as target_handle, created.role,
            created.state, created.invited_by_user_id, created.expires_at,
            created.responded_at, created.created_at, created.request_hash,
            created.response_idempotency_key, created.response_request_hash
          from created
          join profiles profile on profile.user_id = created.target_user_id
        `;
        const invitation = inserted[0];
        if (!invitation) return [] as InvitationRow[];

        await transaction`
          insert into notifications (
            id, user_id, kind, title, body, action_url,
            related_resource_type, related_resource_id, idempotency_key
          ) values (
            gen_random_uuid(), ${partiesRow.target_id}::uuid, 'admin_issue', 'WeVid staff invitation',
            ${`You were invited to the ${input.role} staff role.`}, '/app/settings/staff',
            'staff_invitation', ${invitation.id}::uuid, ${`staff-invitation:${invitation.id}`}
          ) on conflict (user_id, idempotency_key) do nothing
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            gen_random_uuid(), ${partiesRow.actor_id}::uuid, 'staff_invitation', ${invitation.id}::uuid,
            'staff.invited',
            ${JSON.stringify({ targetUserId: partiesRow.target_id, role: input.role, reason: input.reason })}::jsonb,
            ${input.idempotencyKey}
          )
        `;
        return inserted;
      });
      return rows[0] ? toInvitation(rows[0]) : null;
    },

    async updateStaffMembership(input) {
      const requestHash = hashRequest({
        membershipId: input.membershipId,
        action: input.action,
        role: input.role ?? null,
        reason: input.reason
      });
      const rows: StaffMemberRow[] = await sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext('wevid_staff_owner_governance'))`;
        const actors = await transaction<Array<{ actor_id: string }>>`
          select id as actor_id from users
          where supabase_user_id = ${input.supabaseUserId}::uuid and state = 'active'
          limit 1
        `;
        const actor = actors[0];
        if (!actor) return [] as StaffMemberRow[];
        const receipts = await transaction<Array<{ request_hash: string; response: StaffMemberRow }>>`
          select request_hash, response
          from staff_membership_action_receipts
          where actor_user_id = ${actor.actor_id}::uuid
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const receipt = receipts[0];
        if (receipt) {
          if (receipt.request_hash !== requestHash) {
            throw new AdminRepositoryStateConflictError("The idempotency key was already used for a different staff membership action");
          }
          return [receipt.response];
        }
        const currentRows = await transaction<StaffMemberRow[]>`
          select membership.id as membership_id, membership.user_id, profile.handle, profile.display_name,
            membership.role, membership.state, membership.created_at
          from staff_memberships membership
          join profiles profile on profile.user_id = membership.user_id
          where membership.id = ${input.membershipId}::uuid
          for update of membership
        `;
        const current = currentRows[0];
        if (!current) return [] as StaffMemberRow[];

        const removesOwner = current.role === "owner" && (
          input.action !== "change_role" || input.role !== "owner"
        );
        if (removesOwner && current.state === "active") {
          const ownerRows = await transaction<Array<{ count: string | number }>>`
            select count(*) as count from staff_memberships
            where role = 'owner' and state = 'active' and id <> ${input.membershipId}::uuid
          `;
          if (Number(ownerRows[0]?.count ?? 0) === 0) {
            throw new AdminRepositoryStateConflictError("The final active owner cannot be changed, suspended, or revoked");
          }
        }

        if (input.action === "change_role" && input.role) {
          const duplicates = await transaction<Array<{ id: string }>>`
            select id from staff_memberships
            where user_id = ${current.user_id}::uuid
              and role = ${input.role}::staff_role
              and id <> ${input.membershipId}::uuid
            limit 1
          `;
          if (duplicates[0]) {
            throw new AdminRepositoryStateConflictError("That staff member already has the requested role record");
          }
        }

        const updated = await transaction<StaffMemberRow[]>`
          update staff_memberships membership
          set
            role = case when ${input.action} = 'change_role' then ${input.role ?? current.role}::staff_role else role end,
            state = case
              when ${input.action} = 'suspend' then 'suspended'
              when ${input.action} = 'revoke' then 'revoked'
              else state
            end
          from profiles profile
          where membership.id = ${input.membershipId}::uuid
            and profile.user_id = membership.user_id
          returning membership.id as membership_id, membership.user_id, profile.handle, profile.display_name,
            membership.role, membership.state, membership.created_at
        `;
        const changed = updated[0];
        if (!changed) return [] as StaffMemberRow[];

        if (input.action === "suspend" || input.action === "revoke") {
          await transaction`
            update app_sessions set revoked_at = coalesce(revoked_at, now())
            where user_id = ${changed.user_id}::uuid and revoked_at is null
          `;
        }
        await transaction`
          insert into staff_membership_action_receipts (
            actor_user_id, membership_id, idempotency_key, request_hash, response
          ) values (
            ${actor.actor_id}::uuid, ${changed.membership_id}::uuid, ${input.idempotencyKey},
            ${requestHash}, jsonb_build_object(
              'membership_id', ${changed.membership_id}::text,
              'user_id', ${changed.user_id}::text,
              'handle', ${changed.handle}::text,
              'display_name', ${changed.display_name}::text,
              'role', ${changed.role}::text,
              'state', ${changed.state}::text,
              'created_at', ${new Date(changed.created_at).toISOString()}::text
            )
          )
        `;
        await transaction`
          insert into notifications (
            id, user_id, kind, title, body, action_url,
            related_resource_type, related_resource_id, idempotency_key
          ) values (
            gen_random_uuid(), ${changed.user_id}::uuid, 'admin_issue', 'WeVid staff access changed',
            ${`Your staff access was updated: ${input.action}.`}, '/app/settings/staff',
            'staff_membership', ${changed.membership_id}::uuid, ${`staff-membership:${input.idempotencyKey}`}
          ) on conflict (user_id, idempotency_key) do nothing
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            gen_random_uuid(), ${actor.actor_id}::uuid, 'staff_membership', ${changed.membership_id}::uuid,
            ${`staff.${input.action}`},
            ${JSON.stringify({
              reason: input.reason,
              before: { role: current.role, state: current.state },
              after: { role: changed.role, state: changed.state }
            })}::jsonb,
            ${input.idempotencyKey}
          )
        `;
        return updated;
      });
      return rows[0] ? toStaffMember(rows[0]) : null;
    },

    async listCurrentStaffInvitations(supabaseUserId) {
      const rows = await sql.unsafe<InvitationRow[]>(
        `${invitationSelect}
         join users target on target.id = invitation.target_user_id
         where target.supabase_user_id = $1::uuid
           and invitation.state = 'pending'
           and invitation.expires_at > now()
         order by invitation.created_at desc`,
        [supabaseUserId]
      );
      return { items: rows.map(toInvitation) };
    },

    async respondStaffInvitation(input) {
      const requestHash = hashRequest({ invitationId: input.invitationId, decision: input.decision });
      const rows: InvitationRow[] = await sql.begin(async (transaction) => {
        const invitations = await transaction<InvitationRow[]>`
          ${transaction.unsafe(invitationSelect)}
          join users target on target.id = invitation.target_user_id
          where invitation.id = ${input.invitationId}::uuid
            and target.supabase_user_id = ${input.supabaseUserId}::uuid
          for update of invitation
        `;
        const invitation = invitations[0];
        if (!invitation) return [] as InvitationRow[];
        if (invitation.response_idempotency_key === input.idempotencyKey) {
          if (invitation.response_request_hash !== requestHash) {
            throw new AdminRepositoryStateConflictError("The idempotency key was already used for a different invitation response");
          }
          return [invitation];
        }
        const reusedKeys = await transaction<Array<{ id: string }>>`
          select id from staff_invitations
          where target_user_id = ${invitation.target_user_id}::uuid
            and response_idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (reusedKeys[0]) {
          throw new AdminRepositoryStateConflictError("The idempotency key was already used for a different invitation response");
        }
        if (invitation.state !== "pending" || new Date(invitation.expires_at).getTime() <= Date.now()) {
          throw new AdminRepositoryStateConflictError("This staff invitation is no longer active");
        }
        const nextState = input.decision === "accept" ? "accepted" : "declined";
        if (input.decision === "accept") {
          await transaction`
            insert into staff_memberships (id, user_id, role, state, granted_by_user_id)
            values (
              gen_random_uuid(), ${invitation.target_user_id}::uuid, ${invitation.role}::staff_role,
              'active', ${invitation.invited_by_user_id}::uuid
            )
            on conflict (user_id, role) do update set
              state = 'active',
              granted_by_user_id = excluded.granted_by_user_id
          `;
        }
        const updated = await transaction<InvitationRow[]>`
          update staff_invitations invitation
          set state = ${nextState}, responded_at = now(), updated_at = now(),
            response_idempotency_key = ${input.idempotencyKey},
            response_request_hash = ${requestHash}
          from profiles profile
          where invitation.id = ${input.invitationId}::uuid
            and profile.user_id = invitation.target_user_id
          returning invitation.id, invitation.target_user_id, profile.handle as target_handle,
            invitation.role, invitation.state, invitation.invited_by_user_id,
            invitation.expires_at, invitation.responded_at, invitation.created_at,
            invitation.request_hash, invitation.response_idempotency_key,
            invitation.response_request_hash
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            gen_random_uuid(), ${invitation.target_user_id}::uuid, 'staff_invitation', ${invitation.id}::uuid,
            ${`staff.invitation_${nextState}`}, ${JSON.stringify({ role: invitation.role })}::jsonb,
            ${input.idempotencyKey}
          )
        `;
        return updated;
      });
      return rows[0] ? toInvitation(rows[0]) : null;
    }
  };
}

function hashRequest(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toStaffMember(row: StaffMemberRow): AdminStaffMember {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function toInvitation(row: InvitationRow): StaffInvitation {
  return {
    id: row.id,
    targetUserId: row.target_user_id,
    targetHandle: row.target_handle,
    role: row.role,
    state: row.state,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}
