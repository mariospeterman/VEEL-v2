import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordOnboardingEvent } = vi.hoisted(() => ({
  recordOnboardingEvent: vi.fn()
}));
vi.mock("@/analytics/onboarding-analytics", () => ({ recordOnboardingEvent }));

import { handleWalletAccountNotFound } from "./wallet-account-not-found";

describe("handleWalletAccountNotFound", () => {
  beforeEach(() => {
    recordOnboardingEvent.mockReset();
  });

  it("records the outcome once and invokes the UI handoff once", () => {
    const handoff = vi.fn();

    handleWalletAccountNotFound(handoff);

    expect(recordOnboardingEvent).toHaveBeenCalledOnce();
    expect(recordOnboardingEvent).toHaveBeenCalledWith("account_not_found");
    expect(handoff).toHaveBeenCalledOnce();
  });
});
