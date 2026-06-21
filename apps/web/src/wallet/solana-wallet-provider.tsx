"use client";

import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { parsePublicWebEnv } from "@veel/config/public";
import { useMemo } from "react";

export function SolanaWalletProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const env = useMemo(() => parsePublicWebEnv(process.env), []);
  const endpoint = useMemo(() => {
    return (
      env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      (env.NEXT_PUBLIC_SOLANA_CHAIN === "solana:mainnet" ? clusterApiUrl("mainnet-beta") : clusterApiUrl("devnet"))
    );
  }, [env.NEXT_PUBLIC_SOLANA_CHAIN, env.NEXT_PUBLIC_SOLANA_RPC_URL]);
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter()
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider autoConnect wallets={wallets}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
