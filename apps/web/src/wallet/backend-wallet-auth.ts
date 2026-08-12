"use client";

import {
  createWalletAuthChallenge,
  createWalletAuthSession,
  type CreateWalletAuthChallengeRequest,
  type LinkWalletRequest
} from "@/api-mutations";
import { readPublicWebEnv } from "@/public-env";
import { saveWalletSession } from "./wallet-session";

export type WalletAuthProvider = CreateWalletAuthChallengeRequest["provider"];
export type WalletChain = LinkWalletRequest["chain"];

export async function createBackendWalletSession({
  address,
  provider,
  signMessage
}: {
  address: string;
  provider: WalletAuthProvider;
  signMessage: (message: string) => Promise<Uint8Array>;
}) {
  const chain = walletChain();
  const challenge = await createWalletAuthChallenge({
    address,
    chain,
    provider
  });
  const signature = await signMessage(challenge.message);
  const session = await createWalletAuthSession({
    address,
    chain,
    provider,
    proof: {
      challengeId: challenge.id,
      message: challenge.message,
      signature: bytesToBase64(signature),
      signatureEncoding: "base64"
    }
  });

  saveWalletSession({
    expiresAt: session.expiresAt,
    address: session.wallet.address,
    provider: session.wallet.provider
  });

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
