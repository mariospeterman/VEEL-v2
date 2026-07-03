import { describe, expect, it } from "vitest";
import { isE2eAuthEnabled } from "./e2e-auth";
import { appAccessRedirectForPath, signInRedirectForPath } from "./route-guard";

describe("signInRedirectForPath", () => {
  it("keeps the protected route as a safe landing login next parameter", () => {
    expect(signInRedirectForPath("/app/wallet")).toBe("/?mode=login&next=%2Fapp%2Fwallet");
    expect(signInRedirectForPath("/mutuals/feed")).toBe("/?mode=login&next=%2Fmutuals%2Ffeed");
  });
});

describe("isE2eAuthEnabled", () => {
  it("allows a server-only e2e switch outside production", () => {
    expect(
      isE2eAuthEnabled({
        DEPLOY_ENV: "preview",
        ENABLE_E2E_AUTH: "true",
        NODE_ENV: "test",
        NEXT_PUBLIC_ENABLE_E2E_AUTH: "false"
      })
    ).toBe(true);
  });

  it("keeps e2e auth disabled in production even if the switch is set", () => {
    expect(
      isE2eAuthEnabled({
        DEPLOY_ENV: "production",
        ENABLE_E2E_AUTH: "true",
        NODE_ENV: "test",
        NEXT_PUBLIC_ENABLE_E2E_AUTH: "true"
      })
    ).toBe(false);
  });
});

describe("appAccessRedirectForPath", () => {
  it("routes incomplete backend app access to the correct remediation surface", () => {
    expect(appAccessRedirectForPath("/app/messages", "identity_required")).toBe(
      "/?mode=onboarding&step=profile&next=%2Fapp%2Fmessages"
    );
    expect(appAccessRedirectForPath("/app/messages", "wallet_required")).toBe(
      "/?mode=onboarding&step=wallet&next=%2Fapp%2Fmessages"
    );
    expect(appAccessRedirectForPath("/app/messages", "age_required")).toBe(
      "/?mode=onboarding&step=age&next=%2Fapp%2Fmessages"
    );
    expect(appAccessRedirectForPath("/app/messages", "age_pending")).toBe(
      "/?mode=onboarding&step=age&next=%2Fapp%2Fmessages"
    );
    expect(appAccessRedirectForPath("/app/messages", "blocked")).toBe(
      "/?mode=login&next=%2Fapp%2Fmessages"
    );
  });
});
