"use client";

import { createContext, useContext } from "react";
import { ProviderSessionLogoutProvider } from "./provider-session-logout";
import { SolanaWalletProvider } from "./solana-wallet-provider";

const WalletRuntimeBoundary = createContext(false);

export function WalletRuntimeBaseProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  const alreadyMounted = useContext(WalletRuntimeBoundary);

  if (alreadyMounted) return children;

  return (
    <WalletRuntimeBoundary.Provider value>
      <ProviderSessionLogoutProvider>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </ProviderSessionLogoutProvider>
    </WalletRuntimeBoundary.Provider>
  );
}
