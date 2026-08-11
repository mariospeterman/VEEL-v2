import { describe, expect, it } from "vitest";
import { resolveCapabilitiesFromRecords } from "../src/modules/verification/verification-repository";
import type {
  VerificationPurpose,
  VerificationRecordResource
} from "../src/modules/verification/types";

function validRecord(purpose: VerificationPurpose): VerificationRecordResource {
  return {
    subjectType: "user",
    subjectId: "00000000-0000-4000-8000-000000000001",
    purpose,
    status: "valid",
    provider: "didit",
    method: purpose === "age_access" ? "age_estimation" : "gov_id_selfie",
    assuranceLevel: purpose === "age_access" ? "medium" : "documentary",
    verifiedAt: "2026-08-11T08:00:00.000Z",
    expiresAt: null,
    reusable: false
  };
}

describe("universal account capability policy", () => {
  it("allows an age-verified account to publish SFW media without KYC", () => {
    const resolution = resolveCapabilitiesFromRecords({
      ageAccess: validRecord("age_access"),
      adultContentAccess: null,
      creatorKyc: null,
      orgKyb: null
    });

    expect(resolution.capabilities).toMatchObject({
      canAccessApp: true,
      canUploadMedia: true,
      canPublishMedia: true,
      canPublishAdultMedia: false,
      canMonetize: false,
      canReceivePayouts: false
    });
    expect(resolution.missingRequirements).not.toContain("age_access_required");
    expect(resolution.missingRequirements).toContain("adult_verification_required_for_nsfw");
    expect(resolution.missingRequirements).toContain("creator_kyc_required_for_earning");
  });

  it("requires adult-content verification only for adult-rated publishing", () => {
    const resolution = resolveCapabilitiesFromRecords({
      ageAccess: validRecord("age_access"),
      adultContentAccess: validRecord("adult_content_access"),
      creatorKyc: null,
      orgKyb: null
    });

    expect(resolution.capabilities.canPublishMedia).toBe(true);
    expect(resolution.capabilities.canPublishAdultMedia).toBe(true);
    expect(resolution.capabilities.canMonetize).toBe(false);
  });

  it("does not infer paid plan or organization capabilities from identity checks", () => {
    const resolution = resolveCapabilitiesFromRecords({
      ageAccess: validRecord("age_access"),
      adultContentAccess: validRecord("adult_content_access"),
      creatorKyc: validRecord("creator_kyc"),
      orgKyb: {
        ...validRecord("org_kyb"),
        subjectType: "organization"
      }
    });

    expect(resolution.capabilities).toMatchObject({
      canMonetize: true,
      canReceivePayouts: true,
      canAccessStudio: false,
      canInviteTeam: false,
      canUseTeamPublishing: false,
      canUseAllocationWallets: false,
      canUseComplianceExports: false,
      canAccessEnterprise: false
    });
  });
});
