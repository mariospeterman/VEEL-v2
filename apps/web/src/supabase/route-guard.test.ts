import { describe, expect, it } from "vitest";
import { appAccessRedirectForPath, signInRedirectForPath } from "./route-guard";

describe("signInRedirectForPath", () => {
  it("keeps the protected route as a safe enter next parameter", () => {
    expect(signInRedirectForPath("/wallet")).toBe("/enter?next=%2Fwallet");
    expect(signInRedirectForPath("/mutuals/feed")).toBe("/enter?next=%2Fmutuals%2Ffeed");
  });
});

describe("appAccessRedirectForPath", () => {
  it("routes incomplete backend app access to the correct remediation surface", () => {
    expect(appAccessRedirectForPath("/messages", "identity_required")).toBe(
      "/enter?next=%2Fmessages"
    );
    expect(appAccessRedirectForPath("/messages", "wallet_required")).toBe(
      "/wallet?next=%2Fmessages"
    );
    expect(appAccessRedirectForPath("/messages", "age_required")).toBe(
      "/age?next=%2Fmessages"
    );
    expect(appAccessRedirectForPath("/messages", "age_pending")).toBe(
      "/age?next=%2Fmessages"
    );
    expect(appAccessRedirectForPath("/messages", "blocked")).toBe(
      "/enter?next=%2Fmessages"
    );
  });
});
