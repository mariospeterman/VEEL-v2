import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import type {
  ManagedCreatorRelationshipResource,
  ManagedCreatorRepository
} from "../src/modules/managed-creator/types.js";

const relationship: ManagedCreatorRelationshipResource = {
  id: "00000000-0000-4000-8000-000000000101",
  organizationId: "00000000-0000-4000-8000-000000000102",
  organizationName: "Studio",
  creatorUserId: "00000000-0000-4000-8000-000000000103",
  creatorHandle: "creator",
  state: "active",
  agreementId: "00000000-0000-4000-8000-000000000104",
  agreementVersion: 2,
  agreementState: "proposed",
  permissions: ["analytics_view", "revenue_allocation"],
  creatorShareBps: 8_000,
  enterpriseManagementShareBps: 2_000,
  organizationKybReady: true,
  enterpriseEntitlementReady: true,
  settlementWalletReady: true
};

describe("managed creator routes", () => {
  it("normalizes and hashes changed agreement terms server-side", async () => {
    const repository = managedRepository({
      async proposeAgreement(input) {
        const normalized = {
          permissions: relationship.permissions,
          enterpriseManagementShareBps: relationship.enterpriseManagementShareBps
        };
        expect(input.permissions).toEqual(normalized.permissions);
        expect(input.termsHash).toBe(createHash("sha256").update(JSON.stringify(normalized)).digest("hex"));
        expect(input.idempotencyKey).toBe("agreement-v2");
        return relationship;
      }
    });
    const app = await authenticatedApp(repository);

    const response = await app.inject({
      method: "POST",
      url: `/v1/managed-creator-relationships/${relationship.id}/agreements`,
      headers: { authorization: "Bearer valid", "idempotency-key": "agreement-v2" },
      payload: {
        permissions: ["revenue_allocation", "analytics_view", "analytics_view"],
        enterpriseManagementShareBps: 2_000
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(relationship);
    await app.close();
  });

  it("keeps agreement acceptance and relationship termination as explicit actions", async () => {
    let accepted = false;
    let terminated = false;
    const repository = managedRepository({
      async respondToAgreement(input) {
        accepted = input.decision === "accept" && input.agreementId === relationship.agreementId;
        return { ...relationship, agreementState: "accepted" };
      },
      async terminate(input) {
        terminated = input.reason === "Creator ended management";
        return { ...relationship, state: "terminated", agreementState: "terminated" };
      }
    });
    const app = await authenticatedApp(repository);

    const accept = await app.inject({
      method: "POST",
      url: `/v1/managed-creator-relationships/${relationship.id}/agreements/${relationship.agreementId}/responses`,
      headers: { authorization: "Bearer valid", "idempotency-key": "accept-v2" },
      payload: { decision: "accept" }
    });
    const terminate = await app.inject({
      method: "POST",
      url: `/v1/managed-creator-relationships/${relationship.id}/termination`,
      headers: { authorization: "Bearer valid", "idempotency-key": "terminate-1" },
      payload: { reason: "Creator ended management" }
    });

    expect(accept.statusCode).toBe(200);
    expect(terminate.statusCode).toBe(200);
    expect(accepted).toBe(true);
    expect(terminated).toBe(true);
    await app.close();
  });
});

async function authenticatedApp(repository: ManagedCreatorRepository) {
  return buildApi({
    authVerifier: {
      async verifyToken() {
        return { userId: "00000000-0000-4000-8000-000000000001", supabaseUserId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000099", authenticatedAt: new Date(), authenticationMethod: "wallet" as const };
      }
    },
    managedCreatorRepository: repository
  });
}

function managedRepository(overrides: Partial<ManagedCreatorRepository>): ManagedCreatorRepository {
  return {
    async listMine() { return []; },
    async invite() { return null; },
    async respond() { return null; },
    async proposeAgreement() { return null; },
    async respondToAgreement() { return null; },
    async terminate() { return null; },
    ...overrides
  };
}
