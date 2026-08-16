import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import type { VerificationRepository } from "../src/modules/verification/types.js";

const organizationId = "00000000-0000-4000-8000-000000000301";

describe("organization verification authorization", () => {
  it("rejects before creating an external KYB provider session", async () => {
    let providerCalls = 0;
    const app = await buildApi({
      authVerifier: verifier(),
      verificationRepository: repository({
        async authorizeOrganizationVerification() { return false; }
      }),
      verificationProviderWaterfall: {
        async createSession() {
          providerCalls += 1;
          throw new Error("provider must not be called");
        }
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: { authorization: "Bearer valid", "idempotency-key": "kyb-session-key-1" },
      payload: {
        purpose: "org_kyb",
        providerPreference: "provider_first",
        organizationId,
        source: "organization",
        adultPublisherTermsAccepted: false
      }
    });
    expect(response.statusCode).toBe(403);
    expect(providerCalls).toBe(0);
    await app.close();
  });

  it("rejects an arbitrary organization status read", async () => {
    const app = await buildApi({
      authVerifier: verifier(),
      verificationRepository: repository({
        async resolveCapabilities() { throw new Error("ORGANIZATION_ACCESS_REQUIRED"); }
      })
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/verification/status?organizationId=${organizationId}`,
      headers: { authorization: "Bearer valid" }
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

function verifier() {
  return {
    async verifyToken() {
      return {
        userId: "00000000-0000-4000-8000-000000000001",
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000099",
        authenticatedAt: new Date(),
        authenticationMethod: "wallet" as const
      };
    }
  };
}

function repository(overrides: Partial<VerificationRepository>): VerificationRepository {
  return {
    async authorizeOrganizationVerification() { return true; },
    async createPendingSession() { return "00000000-0000-4000-8000-000000000302"; },
    async applyProviderWebhook() { return "applied"; },
    async updateVerificationFromWebhook() { return true; },
    async findLatestUserVerification() { return null; },
    async findLatestOrganizationVerification() { return null; },
    async resolveCapabilities() {
      return {
        capabilities: {
          canAccessApp: true,
          canCreateProfile: true,
          canViewAgeRestrictedContent: true,
          canStartCreatorOnboarding: true,
          canCreateDraft: true,
          canUploadMedia: true,
          canPublishMedia: true,
          canPublishAdultMedia: false,
          canMonetize: false,
          canReceiveCreatorProceeds: false,
          canAccessCreatorDashboard: true,
          canCreateOrganization: false,
          canAccessStudio: false,
          canInviteTeam: false,
          canUseTeamPublishing: false,
          canUseAllocationWallets: false,
          canUseComplianceExports: false,
          canAccessEnterprise: false
        },
        missingRequirements: [],
        nextBestAction: "none",
        verificationSummary: { ageAccess: null, adultPublisherEligibility: null, creatorKyc: null, orgKyb: null }
      };
    },
    ...overrides
  };
}
