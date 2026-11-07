import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";

export function handleWalletAccountNotFound(onAccountNotFound?: () => void): void {
  recordOnboardingEvent("account_not_found");
  onAccountNotFound?.();
}
