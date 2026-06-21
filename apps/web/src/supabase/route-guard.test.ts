import { describe, expect, it } from "vitest";
import { appAccessRedirectForPath, signInRedirectForPath } from "./route-guard";

describe("signInRedirectForPath", () => {
  it("keeps the protected route as a safe landing login next parameter", () => {
    expect(signInRedirectForPath("/app/wallet")).toBe("/?mode=login&next=%2Fapp%2Fwallet");
    expect(signInRedirectForPath("/mutuals/feed")).toBe("/?mode=login&next=%2Fmutuals%2Ffeed");
  });
});

describe("appAccessRedirectForPath", () => {
  it("routes incomplete backend app access to the correct remediation surface", () => {
    expect(appAccessRedirectForPath("/app/messages", "identity_required")).toBe(
      "/?mode=login&next=%2Fapp%2Fmessages"
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
