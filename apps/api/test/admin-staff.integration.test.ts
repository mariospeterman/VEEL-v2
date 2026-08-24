import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AdminRepositoryStateConflictError,
  createPostgresAdminRepository
} from "../src/modules/admin/admin-repository";
import { createPostgresClient } from "../src/shared/postgres";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("staff RBAC and lifecycle against migrated Postgres", () => {
  it("enforces role boundaries, consent, last-owner protection, audit and session revocation", async () => {
    const databaseUrl = process.env.API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
    const host = safeHost(databaseUrl);
    if (!databaseUrl || !["127.0.0.1", "localhost"].includes(host)) {
      throw new Error("A loopback API_INTEGRATION_DATABASE_URL is required");
    }

    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresAdminRepository(databaseUrl);
    const users = {
      owner: randomUUID(),
      finance: randomUUID(),
      safety: randomUUID(),
      ops: randomUUID(),
      target: randomUUID()
    };
    const ownerMembershipId = randomUUID();
    const membershipIds = [ownerMembershipId, randomUUID(), randomUUID(), randomUUID()] as const;
    const sessionId = randomUUID();
    const suffix = users.owner.replaceAll("-", "").slice(0, 8);

    try {
      for (const [label, userId] of Object.entries(users)) {
        await sql`insert into users (id, supabase_user_id, state) values (${userId}::uuid, ${userId}::uuid, 'active')`;
        await sql`
          insert into profiles (user_id, handle, display_name, visibility)
          values (${userId}::uuid, ${`staff_${label}_${suffix}`}, ${`Staff ${label}`}, 'private')
        `;
      }
      await sql`
        insert into staff_memberships (id, user_id, role, state, granted_by_user_id) values
          (${membershipIds[0]}::uuid, ${users.owner}::uuid, 'owner', 'active', ${users.owner}::uuid),
          (${membershipIds[1]}::uuid, ${users.finance}::uuid, 'finance', 'active', ${users.owner}::uuid),
          (${membershipIds[2]}::uuid, ${users.safety}::uuid, 'trust_safety', 'active', ${users.owner}::uuid),
          (${membershipIds[3]}::uuid, ${users.ops}::uuid, 'ops', 'active', ${users.owner}::uuid)
      `;

      expect(await repository.hasAdminPermission(users.finance, "admin.refunds.decide")).toBe(true);
      expect(await repository.hasAdminPermission(users.finance, "admin.content.moderate")).toBe(false);
      expect(await repository.hasAdminPermission(users.safety, "admin.content.moderate")).toBe(true);
      expect(await repository.hasAdminPermission(users.safety, "admin.payment_policy.write")).toBe(false);
      expect(await repository.hasAdminPermission(users.ops, "admin.provider_events.replay")).toBe(true);
      expect(await repository.hasAdminPermission(users.ops, "admin.refunds.decide")).toBe(false);

      const expiredInvitationId = randomUUID();
      await sql`
        insert into staff_invitations (
          id, target_user_id, role, state, invited_by_user_id, expires_at,
          idempotency_key, request_hash, created_at
        ) values (
          ${expiredInvitationId}::uuid, ${users.target}::uuid, 'support', 'pending', ${users.owner}::uuid,
          now() - interval '1 hour', ${`expired-${suffix}`}, 'expired-fixture', now() - interval '2 hours'
        )
      `;

      const invitation = await repository.inviteStaff({
        supabaseUserId: users.owner,
        targetUserId: users.target,
        role: "support",
        expiresInHours: 24,
        reason: "Integration support coverage",
        idempotencyKey: `invite-${suffix}`
      });
      expect(invitation).toMatchObject({ targetUserId: users.target, role: "support", state: "pending" });
      const expiredRows = await sql<Array<{ state: string }>>`
        select state from staff_invitations where id = ${expiredInvitationId}::uuid
      `;
      expect(expiredRows[0]?.state).toBe("expired");

      const concurrentInvitations = await Promise.allSettled([
        repository.inviteStaff({
          supabaseUserId: users.owner,
          targetUserId: users.target,
          role: "creator_success",
          expiresInHours: 24,
          reason: "First concurrent invitation",
          idempotencyKey: `concurrent-a-${suffix}`
        }),
        repository.inviteStaff({
          supabaseUserId: users.owner,
          targetUserId: users.target,
          role: "creator_success",
          expiresInHours: 24,
          reason: "Second concurrent invitation",
          idempotencyKey: `concurrent-b-${suffix}`
        })
      ]);
      expect(concurrentInvitations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejectedInvitation = concurrentInvitations.find((result) => result.status === "rejected");
      expect(rejectedInvitation?.status === "rejected" ? rejectedInvitation.reason : null)
        .toBeInstanceOf(AdminRepositoryStateConflictError);
      expect((await repository.inviteStaff({
        supabaseUserId: users.owner,
        targetUserId: users.target,
        role: "support",
        expiresInHours: 24,
        reason: "Integration support coverage",
        idempotencyKey: `invite-${suffix}`
      }))?.id).toBe(invitation?.id);
      await expect(repository.inviteStaff({
        supabaseUserId: users.owner,
        targetUserId: users.target,
        role: "support",
        expiresInHours: 24,
        reason: "Different replay payload",
        idempotencyKey: `invite-${suffix}`
      })).rejects.toBeInstanceOf(AdminRepositoryStateConflictError);
      expect((await repository.listCurrentStaffInvitations(users.target)).items)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: invitation?.id, role: "support" })]));

      const accepted = await repository.respondStaffInvitation({
        supabaseUserId: users.target,
        invitationId: invitation?.id as string,
        decision: "accept",
        idempotencyKey: `accept-${suffix}`
      });
      expect(accepted?.state).toBe("accepted");
      expect((await repository.respondStaffInvitation({
        supabaseUserId: users.target,
        invitationId: invitation?.id as string,
        decision: "accept",
        idempotencyKey: `accept-${suffix}`
      }))?.state).toBe("accepted");
      await expect(repository.respondStaffInvitation({
        supabaseUserId: users.target,
        invitationId: invitation?.id as string,
        decision: "decline",
        idempotencyKey: `accept-${suffix}`
      })).rejects.toBeInstanceOf(AdminRepositoryStateConflictError);
      const supportMembership = (await repository.getStaffDirectory()).memberships.find(
        (membership) => membership.userId === users.target && membership.role === "support"
      );
      expect(supportMembership?.state).toBe("active");

      await sql`
        insert into app_sessions (
          id, user_id, token_hash, expires_at, authentication_method, authenticated_at
        ) values (
          ${sessionId}::uuid, ${users.target}::uuid, ${`staff-session-${suffix}`},
          now() + interval '1 day', 'wallet', now()
        )
      `;
      const suspended = await repository.updateStaffMembership({
        supabaseUserId: users.owner,
        membershipId: supportMembership?.membershipId as string,
        action: "suspend",
        reason: "Integration suspension proof",
        idempotencyKey: `suspend-${suffix}`
      });
      expect((await repository.updateStaffMembership({
        supabaseUserId: users.owner,
        membershipId: supportMembership?.membershipId as string,
        action: "suspend",
        reason: "Integration suspension proof",
        idempotencyKey: `suspend-${suffix}`
      }))?.state).toBe(suspended?.state);
      await expect(repository.updateStaffMembership({
        supabaseUserId: users.owner,
        membershipId: supportMembership?.membershipId as string,
        action: "suspend",
        reason: "Different replay payload",
        idempotencyKey: `suspend-${suffix}`
      })).rejects.toBeInstanceOf(AdminRepositoryStateConflictError);
      const sessions = await sql<Array<{ revoked_at: Date | null }>>`
        select revoked_at from app_sessions where id = ${sessionId}::uuid
      `;
      expect(sessions[0]?.revoked_at).not.toBeNull();

      await expect(repository.updateStaffMembership({
        supabaseUserId: users.owner,
        membershipId: ownerMembershipId,
        action: "revoke",
        reason: "Prove final owner safety",
        idempotencyKey: `owner-revoke-${suffix}`
      })).rejects.toBeInstanceOf(AdminRepositoryStateConflictError);

      const audit = await sql<Array<{ action: string }>>`
        select action from audit_events
        where actor_user_id in (${users.owner}::uuid, ${users.target}::uuid)
          and action like 'staff.%'
      `;
      expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining([
        "staff.invited",
        "staff.invitation_accepted",
        "staff.suspend"
      ]));
    } finally {
      await sql`delete from notifications where user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from audit_events where actor_user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from app_sessions where user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from staff_membership_action_receipts where actor_user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from staff_invitations where target_user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from staff_permissions where user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from staff_memberships where user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from profiles where user_id = any(${Object.values(users)}::uuid[])`;
      await sql`delete from users where id = any(${Object.values(users)}::uuid[])`;
      await repository.close?.();
      await sql.end({ timeout: 5 });
    }
  });
});

function safeHost(databaseUrl: string | undefined) {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : "";
  } catch {
    return "";
  }
}
