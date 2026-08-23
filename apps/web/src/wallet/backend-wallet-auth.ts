"use client";

import {
  createWalletAuthChallenge,
  createWalletAuthSession,
  type CreateWalletAuthChallengeRequest,
  type LinkWalletRequest
} from "@/api-mutations";
import { readPublicWebEnv } from "@/public-env";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";

export type WalletAuthProvider = CreateWalletAuthChallengeRequest["provider"];
export type WalletAuthPurpose = CreateWalletAuthChallengeRequest["purpose"];
export type WalletChain = LinkWalletRequest["chain"];

export async function createBackendWalletSession({
  address,
  provider,
  purpose,
  signMessage
}: {
  address: string;
  provider: WalletAuthProvider;
  purpose: WalletAuthPurpose;
  signMessage: (message: string) => Promise<Uint8Array>;
}) {
  const chain = walletChain();
  const challenge = await createWalletAuthChallenge({
    address,
    chain,
    provider,
    purpose
  });
  recordOnboardingEvent("auth_method_selected", provider);
  const signature = await signMessage(challenge.message);
  const session = await createWalletAuthSession({
    address,
    chain,
    provider,
    purpose,
    proof: {
      challengeId: challenge.id,
      message: challenge.message,
      signature: bytesToBase64(signature),
      signatureEncoding: "base64"
    }
  });

  recordOnboardingEvent("wallet_authentication_completed");
  recordOnboardingEvent("wallet_ownership_verified");
  if (purpose === "login") recordOnboardingEvent("returning_login_completed");

  return session;
}

export function walletChain(): WalletChain {
  return readPublicWebEnv().NEXT_PUBLIC_SOLANA_CHAIN === "solana:mainnet" ? "solana_mainnet" : "solana_devnet";
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
