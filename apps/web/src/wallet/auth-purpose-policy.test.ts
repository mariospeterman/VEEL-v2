import { describe, expect, it } from "vitest";
import { embeddedWalletCreationForPurpose, recoveryIdentityMayBeCreated } from "./auth-purpose-policy";

describe("authentication purpose policy", () => {
  it("never provisions an embedded wallet during login", () => {
    expect(embeddedWalletCreationForPurpose("login")).toBe("off");
  });

  it("allows the onboarding flow to provision a user-controlled wallet", () => {
    expect(embeddedWalletCreationForPurpose("onboarding")).toBe("users-without-wallets");
  });

  it("does not create a recovery identity during login", () => {
    expect(recoveryIdentityMayBeCreated("recovery")).toBe(false);
    expect(recoveryIdentityMayBeCreated("link")).toBe(true);
  });
});
