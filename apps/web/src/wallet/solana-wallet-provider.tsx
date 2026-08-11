"use client";

import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { readPublicWebEnv } from "@/public-env";
import { useCallback, useMemo } from "react";
import { useProviderSessionLogoutRegistration } from "./provider-session-logout";

export function SolanaWalletProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const env = useMemo(() => readPublicWebEnv(), []);
  const endpoint = useMemo(() => {
    return (
      env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      (env.NEXT_PUBLIC_SOLANA_CHAIN === "solana:mainnet" ? clusterApiUrl("mainnet-beta") : clusterApiUrl("devnet"))
    );
  }, [env.NEXT_PUBLIC_SOLANA_CHAIN, env.NEXT_PUBLIC_SOLANA_RPC_URL]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider autoConnect wallets={[]}>
        <WalletModalProvider>
          <SolanaSessionLogoutRegistration />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function SolanaSessionLogoutRegistration() {
  const { disconnect, wallet } = useWallet();
  const logoutSession = useCallback(async () => {
    if (wallet) {
      await disconnect();
    }
  }, [disconnect, wallet]);
  useProviderSessionLogoutRegistration("solana-wallet-adapter", logoutSession);
  return null;
}
