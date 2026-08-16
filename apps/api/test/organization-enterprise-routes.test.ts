import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import type { OrganizationMemberResource, OrganizationRepository } from "../src/modules/organization/types.js";

const organizationId = "00000000-0000-4000-8000-000000000201";
const membershipId = "00000000-0000-4000-8000-000000000202";
const member: OrganizationMemberResource = {
  id: membershipId,
  organizationId,
  userId: "00000000-0000-4000-8000-000000000203",
  handle: "team_member",
  displayName: "Team Member",
  role: "member",
  state: "invited",
  invitedByUserId: "00000000-0000-4000-8000-000000000001",
  joinedAt: null,
  createdAt: "2026-08-16T08:00:00.000Z",
  isCurrentUser: false
};

describe("Enterprise organization routes", () => {
  it("normalizes and hashes member invitations server-side", async () => {
    const app = await authenticatedApp(repository({
      async inviteMember(input) {
        const normalized = { handle: "team_member", role: "member" };
        expect(input).toMatchObject({ organizationId, ...normalized, idempotencyKey: "team-invite-key-1" });
        expect(input.requestHash).toBe(createHash("sha256").update(JSON.stringify(normalized)).digest("hex"));
        return member;
      }
    }));
    const response = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { authorization: "Bearer valid", "idempotency-key": "team-invite-key-1" },
      payload: { handle: " Team_Member ", role: "member" }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(member);
    await app.close();
  });

  it("keeps invitation acceptance and owner role updates explicit", async () => {
    let accepted = false;
    let updated = false;
    const app = await authenticatedApp(repository({
      async respondToMembership(input) {
        accepted = input.decision === "accept";
        return { ...member, state: "active", isCurrentUser: true };
      },
      async updateMember(input) {
        updated = input.role === "viewer" && input.state === "suspended";
        return { ...member, role: "viewer", state: "suspended" };
      }
    }));
    const accept = await app.inject({
      method: "POST",
      url: `/v1/organization-memberships/${membershipId}/responses`,
      headers: { authorization: "Bearer valid", "idempotency-key": "team-accept-key-1" },
      payload: { decision: "accept" }
    });
    const update = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organizationId}/members/${membershipId}`,
      headers: { authorization: "Bearer valid", "idempotency-key": "team-update-key-1" },
      payload: { role: "viewer", state: "suspended" }
    });
    expect(accept.statusCode).toBe(200);
    expect(update.statusCode).toBe(200);
    expect(accepted).toBe(true);
    expect(updated).toBe(true);
    await app.close();
  });
});

async function authenticatedApp(organizationRepository: OrganizationRepository) {
  return buildApi({
    authVerifier: {
      async verifyToken() {
        return {
          userId: "00000000-0000-4000-8000-000000000001",
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          sessionId: "00000000-0000-4000-8000-000000000099",
          authenticatedAt: new Date(),
          authenticationMethod: "wallet" as const
        };
      }
    },
    organizationRepository
  });
}

function repository(overrides: Partial<OrganizationRepository>): OrganizationRepository {
  return {
    async listMyDashboards() { return { items: [], nextCursor: null }; },
    async listMembers() { return []; },
    async inviteMember() { return null; },
    async respondToMembership() { return null; },
    async updateMember() { return null; },
    ...overrides
  };
}
