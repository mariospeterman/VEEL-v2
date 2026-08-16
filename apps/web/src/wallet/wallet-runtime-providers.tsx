"use client";

import { createContext, useContext } from "react";
import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import { ProviderSessionLogoutProvider } from "./provider-session-logout";
import { SolanaWalletProvider } from "./solana-wallet-provider";

const WalletRuntimeBoundary = createContext(false);

export function WalletRuntimeProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  const alreadyMounted = useContext(WalletRuntimeBoundary);

  if (alreadyMounted) return children;

  return (
    <WalletRuntimeBoundary.Provider value>
      <ProviderSessionLogoutProvider>
        <EmbeddedWalletProviders>
          <SolanaWalletProvider>{children}</SolanaWalletProvider>
        </EmbeddedWalletProviders>
      </ProviderSessionLogoutProvider>
    </WalletRuntimeBoundary.Provider>
  );
}
