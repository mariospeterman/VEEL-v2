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
  signal,
  signMessage
}: {
  address: string;
  provider: WalletAuthProvider;
  purpose: WalletAuthPurpose;
  signal?: AbortSignal | undefined;
  signMessage: (message: string) => Promise<Uint8Array>;
}) {
  const chain = walletChain();
  const challenge = await abortable(
    createWalletAuthChallenge({
      address,
      chain,
      provider,
      purpose
    }),
    signal
  );
  const signature = await abortable(signMessage(challenge.message), signal);
  const session = await abortable(
    createWalletAuthSession({
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
    }),
    signal
  );

  recordOnboardingEvent("wallet_authentication_completed");
  recordOnboardingEvent("wallet_ownership_verified");
  if (purpose === "login") recordOnboardingEvent("returning_login_completed");

  return session;
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(walletFlowCancelledError());

  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(walletFlowCancelledError());
    signal.addEventListener("abort", cancel, { once: true });

    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", cancel);
    });
  });
}

function walletFlowCancelledError() {
  return new DOMException("Wallet sign-in was cancelled.", "AbortError");
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
