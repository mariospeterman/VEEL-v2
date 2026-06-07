import { describe, expect, it } from "vitest";
import { signInRedirectForPath } from "./route-guard";

describe("signInRedirectForPath", () => {
  it("keeps the protected route as a safe enter next parameter", () => {
    expect(signInRedirectForPath("/wallet")).toBe("/enter?next=%2Fwallet");
    expect(signInRedirectForPath("/mutuals/feed")).toBe("/enter?next=%2Fmutuals%2Ffeed");
  });
});
