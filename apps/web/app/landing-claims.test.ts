import { describe, expect, it } from "vitest";
import { approvedLandingClaim, landingClaims } from "./landing-claims";
import { landingContent } from "./landing-content";

describe("landing claims authority", () => {
  it("renders only approved claims through the public content authority", () => {
    const rendered = JSON.stringify(landingContent);
    for (const claim of landingClaims) {
      if (claim.approval === "approved") expect(rendered).toContain(claim.wording);
      else expect(rendered).not.toContain(claim.wording);
    }
  });

  it("fails closed for a claim that has not passed publication approval", () => {
    expect(() => approvedLandingClaim("external-reach-research")).toThrow(/not approved/);
    expect(() => approvedLandingClaim("missing-claim")).toThrow(/not approved/);
  });

  it("keeps risky or unavailable promises out of public copy", () => {
    const copy = JSON.stringify(landingContent).toLowerCase();
    for (const banned of ["guaranteed", "risk-free", "instant cash", "zero fees", "uncensorable", "100% private"]) {
      expect(copy).not.toContain(banned);
    }
    expect(copy).toContain("product offers · planned rollout");
  });
});
