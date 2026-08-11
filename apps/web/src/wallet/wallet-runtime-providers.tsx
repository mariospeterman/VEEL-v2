"use client";

import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import { ProviderSessionLogoutProvider } from "./provider-session-logout";
import { SolanaWalletProvider } from "./solana-wallet-provider";

export function WalletRuntimeProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ProviderSessionLogoutProvider>
      <EmbeddedWalletProviders>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </EmbeddedWalletProviders>
    </ProviderSessionLogoutProvider>
  );
}
