export type LandingEntryMode = "login" | "onboard" | null;

export interface LandingEntryState {
  initialAuthError: string | null;
  initialMode: LandingEntryMode;
  initialOnboardingStep: number;
}

type LandingSearchParams = Record<string, string | string[] | undefined>;

const callbackErrors: Record<string, string> = {
  auth_confirm_failed: "We couldn't finish signing you in. Try again.",
  recovery_exchange_failed: "We couldn't finish recovery access. Reconnect your wallet and try again.",
  recovery_link_failed: "We couldn't finish recovery access. Reconnect your wallet and try again.",
  recovery_needs_wallet: "Connect the wallet linked to your WeVid account to continue."
};

export function resolveLandingEntry(searchParams: LandingSearchParams): LandingEntryState {
  const mode = firstValue(searchParams.mode);
  const step = firstValue(searchParams.step);
  const error = firstValue(searchParams.error);
  const initialOnboardingStep = step === "profile" ? 1 : step === "age" ? 2 : 0;
  const initialMode = mode === "login"
    ? "login"
    : mode === "onboarding" || step === "wallet" || step === "profile" || step === "age"
      ? "onboard"
      : null;

  return {
    initialAuthError: error ? callbackErrors[error] ?? null : null,
    initialMode,
    initialOnboardingStep
  };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
