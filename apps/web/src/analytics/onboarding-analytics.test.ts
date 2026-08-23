import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeExpectedOnboardingJourneyExit,
  markOnboardingJourneyHandoff
} from "./onboarding-journey-handoff";

afterEach(() => {
  consumeExpectedOnboardingJourneyExit();
  vi.useRealTimers();
});

describe("onboarding journey analytics", () => {
  it("does not classify one controlled handoff as abandonment", () => {
    vi.useFakeTimers();
    markOnboardingJourneyHandoff();

    expect(consumeExpectedOnboardingJourneyExit()).toBe(true);
    expect(consumeExpectedOnboardingJourneyExit()).toBe(false);
  });

  it("expires a handoff marker when navigation does not happen", () => {
    vi.useFakeTimers();
    markOnboardingJourneyHandoff();
    vi.advanceTimersByTime(10_000);

    expect(consumeExpectedOnboardingJourneyExit()).toBe(false);
  });
});
