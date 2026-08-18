import { describe, expect, it } from "vitest";
import { resolveLandingEntry } from "./landing-entry";

describe("landing entry resolution", () => {
  it("renders login directly with consumer-safe callback copy", () => {
    expect(resolveLandingEntry({
      mode: "login",
      error: "recovery_exchange_failed"
    })).toEqual({
      initialAuthError: "We couldn't finish recovery access. Reconnect your wallet and try again.",
      initialMode: "login",
      initialOnboardingStep: 0
    });
  });

  it("resolves only known onboarding steps", () => {
    expect(resolveLandingEntry({ step: "profile" })).toMatchObject({
      initialMode: "onboard",
      initialOnboardingStep: 1
    });
    expect(resolveLandingEntry({ mode: "onboarding", step: "unknown" })).toMatchObject({
      initialMode: "onboard",
      initialOnboardingStep: 0
    });
  });

  it("does not reflect unknown callback errors or array values", () => {
    expect(resolveLandingEntry({
      mode: ["login", "onboarding"],
      error: "raw-provider-error"
    })).toEqual({
      initialAuthError: null,
      initialMode: "login",
      initialOnboardingStep: 0
    });
  });
});
