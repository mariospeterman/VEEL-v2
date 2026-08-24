import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app";
import { AdminRepositoryStateConflictError } from "../src/modules/admin/admin-repository";
import type { AdminPermission } from "../src/modules/admin/admin-permissions";
import type { AdminRepository } from "../src/modules/admin/types";

const userId = "00000000-0000-4000-8000-000000000001";
const targetUserId = "00000000-0000-4000-8000-000000000002";
const membershipId = "00000000-0000-4000-8000-000000000003";
const invitationId = "00000000-0000-4000-8000-000000000004";

describe("staff lifecycle route policy", () => {
  it("uses the exact read permission for the staff directory", async () => {
    const checked: AdminPermission[] = [];
    const app = await staffApp({
      async hasAdminPermission(_subject, permission) {
        checked.push(permission);
        return permission === "admin.staff.read";
      }
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/staff",
      headers: { authorization: "Bearer valid" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ memberships: [], invitations: [] });
    expect(checked).toEqual(["admin.staff.read"]);
    await app.close();
  });

  it("requires recent authentication and explicit confirmation for staff invitations", async () => {
    const inviteStaff = vi.fn();
    const app = await staffApp({ inviteStaff }, new Date(Date.now() - 16 * 60 * 1000));
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/staff/invitations",
      headers: { authorization: "Bearer valid", "idempotency-key": "staff-invite-1" },
      payload: {
        targetUserId,
        role: "support",
        expiresInHours: 24,
        reason: "Support coverage",
        confirmed: true
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("recent_authentication_required");
    expect(inviteStaff).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps last-owner protection to a conflict without leaking internal state", async () => {
    const app = await staffApp({
      async updateStaffMembership() {
        throw new AdminRepositoryStateConflictError("The final active owner cannot be changed, suspended, or revoked");
      }
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/staff/memberships/${membershipId}`,
      headers: { authorization: "Bearer valid", "idempotency-key": "staff-revoke-1" },
      payload: { action: "revoke", reason: "Ownership rotation", confirmed: true }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "conflict",
      message: "The final active owner cannot be changed, suspended, or revoked"
    });
    await app.close();
  });

  it("lets only the invited canonical user accept their pending role", async () => {
    const app = await staffApp({
      async respondStaffInvitation(input) {
        expect(input).toMatchObject({ invitationId, decision: "accept" });
        return invitation("accepted");
      }
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/staff/invitations/${invitationId}/respond`,
      headers: { authorization: "Bearer valid", "idempotency-key": "staff-accept-1" },
      payload: { decision: "accept" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("accepted");
    await app.close();
  });
});

async function staffApp(overrides: Partial<AdminRepository>, authenticatedAt = new Date()) {
  const repository = {
    async hasAdminPermission() { return true; },
    async getStaffDirectory() { return { memberships: [], invitations: [] }; },
    async inviteStaff() { return invitation("pending"); },
    async updateStaffMembership() {
      return {
        membershipId,
        userId: targetUserId,
        handle: "coworker",
        displayName: "Coworker",
        role: "support",
        state: "active",
        createdAt: new Date().toISOString()
      };
    },
    async listCurrentStaffInvitations() { return { items: [invitation("pending")] }; },
    async respondStaffInvitation() { return invitation("accepted"); },
    ...overrides
  } as unknown as AdminRepository;
  const app = await buildApi({
    authVerifier: {
      async verifyToken() {
        return {
          userId,
          supabaseUserId: userId,
          sessionId: "00000000-0000-4000-8000-000000000010",
          authenticatedAt,
          authenticationMethod: "wallet" as const
        };
      }
    },
    adminRepository: repository
  });
  await app.ready();
  return app;
}

function invitation(state: "pending" | "accepted") {
  return {
    id: invitationId,
    targetUserId,
    targetHandle: "coworker",
    role: "support" as const,
    state,
    invitedByUserId: userId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    respondedAt: state === "accepted" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString()
  };
}
