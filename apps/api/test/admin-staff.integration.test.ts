import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AdminRepositoryStateConflictError,
  createPostgresAdminRepository
} from "../src/modules/admin/admin-repository";
import { createPostgresClient } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("staff RBAC and lifecycle against migrated Postgres", () => {
  it("enforces role boundaries, consent, last-owner protection, audit and session revocation", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();

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

  it("parses and stably paginates joined live-room admin projections", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresAdminRepository(databaseUrl);
    const creatorUserId = randomUUID();
    const roomIds = Array.from({ length: 52 }, () => randomUUID());
    const roomIdSet = new Set<string>(roomIds);
    const suffix = creatorUserId.replaceAll("-", "").slice(0, 8);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${creatorUserId}::uuid, ${creatorUserId}::uuid, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorUserId}::uuid, ${`live_admin_${suffix}`}, 'Live admin fixture', 'private')
      `;

      for (const [index, roomId] of roomIds.entries()) {
        await sql`
          insert into live_rooms (
            id, creator_user_id, title, provider_stream_id, idempotency_key,
            request_hash, created_at, updated_at
          ) values (
            ${roomId}::uuid,
            ${creatorUserId}::uuid,
            ${`Admin live fixture ${index}`},
            ${`admin-live-${suffix}-${index}`},
            ${`admin-live-${suffix}-${index}`},
            ${String(index).padStart(64, "0")},
            '2099-01-01T00:00:00.000Z'::timestamptz,
            '2099-01-01T00:00:00.000Z'::timestamptz
          )
        `;
      }

      const first = await repository.listLiveRooms({});
      expect(first.items.filter((room) => room.creatorUserId === creatorUserId)).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      if (!first.nextCursor) throw new Error("Expected a second admin live-room page");

      const second = await repository.listLiveRooms({ cursor: first.nextCursor });
      const returnedFixtureIds = [...first.items, ...second.items]
        .map((room) => room.id)
        .filter((roomId) => roomIdSet.has(roomId));

      expect(new Set(returnedFixtureIds)).toEqual(roomIdSet);
      expect(returnedFixtureIds).toHaveLength(52);
    } finally {
      await sql`delete from live_rooms where creator_user_id = ${creatorUserId}::uuid`;
      await sql`delete from profiles where user_id = ${creatorUserId}::uuid`;
      await sql`delete from users where id = ${creatorUserId}::uuid`;
      await repository.close?.();
      await sql.end({ timeout: 5 });
    }
  });

  it("serializes organization owner removals and preserves one active owner", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresAdminRepository(databaseUrl);
    const actorUserId = randomUUID();
    const ownerUserIds = [randomUUID(), randomUUID()] as const;
    const organizationId = randomUUID();
    const membershipIds = [randomUUID(), randomUUID()] as const;

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorUserId}::uuid, ${actorUserId}::uuid, 'active'),
          (${ownerUserIds[0]}::uuid, ${ownerUserIds[0]}::uuid, 'active'),
          (${ownerUserIds[1]}::uuid, ${ownerUserIds[1]}::uuid, 'active')
      `;
      await sql`
        insert into organizations (id, name, state, plan, kyb_state)
        values (${organizationId}::uuid, ${`Owner concurrency ${organizationId}`}, 'active', 'enterprise', 'verified')
      `;
      await sql`
        insert into organization_memberships (
          id, organization_id, user_id, role, state, invited_by_user_id, joined_at
        ) values
          (${membershipIds[0]}::uuid, ${organizationId}::uuid, ${ownerUserIds[0]}::uuid, 'owner', 'active', ${actorUserId}::uuid, now()),
          (${membershipIds[1]}::uuid, ${organizationId}::uuid, ${ownerUserIds[1]}::uuid, 'owner', 'active', ${actorUserId}::uuid, now())
      `;

      const removals = await Promise.allSettled(membershipIds.map((membershipId, index) =>
        repository.updateOrganizationMember({
          supabaseUserId: actorUserId,
          organizationId,
          membershipId,
          body: {
            role: "member",
            state: "removed",
            reason: `Concurrent owner removal ${index}`
          },
          idempotencyKey: `owner-removal-${index}`,
          requestHash: String(index + 1).repeat(64)
        })
      ));

      expect(removals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejection = removals.find((result) => result.status === "rejected");
      expect(rejection?.status === "rejected" ? rejection.reason : null)
        .toBeInstanceOf(AdminRepositoryStateConflictError);

      const winningIndex = removals.findIndex((result) => result.status === "fulfilled");
      expect(winningIndex).toBeGreaterThanOrEqual(0);
      const winningMembershipId = membershipIds[winningIndex] as string;
      const winningRequestHash = String(winningIndex + 1).repeat(64);
      const winningBody = {
        role: "member" as const,
        state: "removed" as const,
        reason: `Concurrent owner removal ${winningIndex}`
      };

      const replay = await repository.updateOrganizationMember({
        supabaseUserId: actorUserId,
        organizationId,
        membershipId: winningMembershipId,
        body: winningBody,
        idempotencyKey: `owner-removal-${winningIndex}`,
        requestHash: winningRequestHash
      });
      expect(replay).toMatchObject({
        id: winningMembershipId,
        role: "member",
        state: "removed"
      });

      await expect(repository.updateOrganizationMember({
        supabaseUserId: actorUserId,
        organizationId,
        membershipId: winningMembershipId,
        body: { ...winningBody, reason: "Changed replay payload" },
        idempotencyKey: `owner-removal-${winningIndex}`,
        requestHash: "f".repeat(64)
      })).rejects.toBeInstanceOf(AdminRepositoryStateConflictError);

      const activeOwners = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from organization_memberships
        where organization_id = ${organizationId}::uuid
          and role = 'owner'
          and state = 'active'
      `;
      expect(activeOwners[0]?.count).toBe(1);

      const memberStates = await sql<Array<{ id: string; role: string; state: string }>>`
        select id, role, state
        from organization_memberships
        where organization_id = ${organizationId}::uuid
        order by id
      `;
      expect(memberStates).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: winningMembershipId, role: "member", state: "removed" }),
        expect.objectContaining({ role: "owner", state: "active" })
      ]));

      const auditRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from audit_events
        where actor_user_id = ${actorUserId}::uuid
          and action = 'organization_member_updated'
          and subject_id = any(${membershipIds}::uuid[])
      `;
      expect(auditRows[0]?.count).toBe(1);
    } finally {
      await sql`delete from audit_events where actor_user_id = ${actorUserId}::uuid`;
      await sql`delete from enterprise_action_receipts where organization_id = ${organizationId}::uuid`;
      await sql`delete from organization_memberships where organization_id = ${organizationId}::uuid`;
      await sql`delete from organizations where id = ${organizationId}::uuid`;
      await sql`delete from users where id = any(${[actorUserId, ...ownerUserIds]}::uuid[])`;
      await repository.close?.();
      await sql.end({ timeout: 5 });
    }
  });
});
