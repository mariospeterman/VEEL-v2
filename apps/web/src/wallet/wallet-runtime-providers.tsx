"use client";

import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import { SolanaWalletProvider } from "./solana-wallet-provider";

export function WalletRuntimeProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <EmbeddedWalletProviders>
      <SolanaWalletProvider>{children}</SolanaWalletProvider>
    </EmbeddedWalletProviders>
  );
}
