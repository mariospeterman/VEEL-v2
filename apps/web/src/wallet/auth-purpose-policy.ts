import type { WalletAuthPurpose } from "./backend-wallet-auth";

export function embeddedWalletCreationForPurpose(purpose: WalletAuthPurpose): "off" | "users-without-wallets" {
  return purpose === "onboarding" ? "users-without-wallets" : "off";
}

export function recoveryIdentityMayBeCreated(mode: "link" | "recovery"): boolean {
  return mode === "link";
}
