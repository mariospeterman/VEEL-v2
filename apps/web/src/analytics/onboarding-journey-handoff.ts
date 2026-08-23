let expectedJourneyExit = false;
let expectedJourneyExitTimer: ReturnType<typeof setTimeout> | null = null;

export function markOnboardingJourneyHandoff(): void {
  expectedJourneyExit = true;
  if (expectedJourneyExitTimer) globalThis.clearTimeout(expectedJourneyExitTimer);
  expectedJourneyExitTimer = globalThis.setTimeout(() => {
    expectedJourneyExit = false;
    expectedJourneyExitTimer = null;
  }, 10_000);
}

export function consumeExpectedOnboardingJourneyExit(): boolean {
  const expected = expectedJourneyExit;
  expectedJourneyExit = false;
  if (expectedJourneyExitTimer) globalThis.clearTimeout(expectedJourneyExitTimer);
  expectedJourneyExitTimer = null;
  return expected;
}
