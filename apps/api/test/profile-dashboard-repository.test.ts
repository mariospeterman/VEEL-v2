import { describe, expect, it } from "vitest";
import { resolveCreatorOnboardingKycState } from "../src/modules/profile/profile-dashboard-repository";

describe("creator onboarding KYC state", () => {
  it("keeps revoked verification aligned with the canonical failed state", () => {
    expect(
      resolveCreatorOnboardingKycState(true, {
        status: "revoked",
        assurance_level: "high",
        expires_at: null
      })
    ).toBe("failed");
  });

  it("accepts only current high-assurance verification when KYC is required", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");

    expect(
      resolveCreatorOnboardingKycState(
        true,
        {
          status: "valid",
          assurance_level: "documentary",
          expires_at: new Date("2026-08-21T12:00:00.000Z")
        },
        now
      )
    ).toBe("verified");
    expect(
      resolveCreatorOnboardingKycState(
        true,
        {
          status: "valid",
          assurance_level: "documentary",
          expires_at: now
        },
        now
      )
    ).toBe("required");
  });
});
