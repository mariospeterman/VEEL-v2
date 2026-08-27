import type { Wallet } from "@solana/wallet-adapter-react";

export function walletSupportsMessageSigning(wallet: Pick<Wallet, "adapter">) {
  const { adapter } = wallet;

  if ("signMessage" in adapter && typeof adapter.signMessage === "function") {
    return true;
  }

  if (!("standard" in adapter) || adapter.standard !== true || !("wallet" in adapter)) {
    return false;
  }

  const standardWallet = adapter.wallet;
  if (!standardWallet || typeof standardWallet !== "object" || !("features" in standardWallet)) {
    return false;
  }

  const { features } = standardWallet;
  return Boolean(features && typeof features === "object" && Object.hasOwn(features, "solana:signMessage"));
}
