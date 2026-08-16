"use client";

import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { readPublicWebEnv } from "@/public-env";
import { useCallback, useEffect, useMemo } from "react";
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
      <WalletProvider autoConnect={false} wallets={[]}>
        <WalletModalProvider>
          <WalletModalAccessibilityBridge />
          <SolanaSessionLogoutRegistration />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function WalletModalAccessibilityBridge() {
  useEffect(() => {
    const labelWalletModal = () => {
      for (const modal of document.querySelectorAll<HTMLElement>(".wallet-adapter-modal")) {
        const title = modal.querySelector<HTMLElement>(".wallet-adapter-modal-title");
        const closeButton = modal.querySelector<HTMLElement>(".wallet-adapter-modal-button-close");

        if (title) title.id = "wallet-adapter-modal-title";
        if (closeButton) closeButton.setAttribute("aria-label", "Close wallet chooser");
      }
    };

    labelWalletModal();
    const observer = new MutationObserver(labelWalletModal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
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
