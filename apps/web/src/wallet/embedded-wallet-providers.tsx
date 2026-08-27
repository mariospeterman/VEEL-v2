"use client";

import { PrivyProvider, usePrivy, type PrivyClientConfig } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import { useCallback, useMemo } from "react";
import { useProviderSessionLogoutRegistration } from "./provider-session-logout";
import type { WalletAuthPurpose } from "./backend-wallet-auth";
import { embeddedWalletCreationForPurpose } from "./auth-purpose-policy";

export function EmbeddedWalletProviders({ children, purpose = "login" }: Readonly<{ children: React.ReactNode; purpose?: WalletAuthPurpose }>) {
  const env = readPublicWebEnv();
  const provider = embeddedWalletProviderConfig(env);
  const solanaChain = env.NEXT_PUBLIC_SOLANA_CHAIN;
  const solanaRpcUrl = env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const solanaSubscriptionsUrl = env.NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL ?? toWebSocketRpcUrl(solanaRpcUrl);

  const privyConfig = useMemo<PrivyClientConfig>(
    () => ({
      appearance: {
        accentColor: "#20eaa4",
        landingHeader: "Continue to WeVid",
        loginMessage: "Choose email, social, or passkey. WeVid checks for an existing account before onboarding.",
        showWalletLoginFirst: false,
        theme: "dark",
        walletChainType: "solana-only"
      },
      embeddedWallets: {
        solana: {
          createOnLogin: embeddedWalletCreationForPurpose(purpose)
        }
      },
      loginMethods: ["email", "google", "twitter", "discord", "passkey"],
      solana: {
        rpcs: {
          [solanaChain]: {
            rpc: createSolanaRpc(solanaRpcUrl),
            rpcSubscriptions: createSolanaRpcSubscriptions(solanaSubscriptionsUrl)
          }
        }
      }
    }),
    [purpose, solanaChain, solanaRpcUrl, solanaSubscriptionsUrl]
  );

  if (provider.provider.configured && env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <PrivyProvider appId={env.NEXT_PUBLIC_PRIVY_APP_ID} config={privyConfig}>
        <PrivySessionLogoutRegistration />
        {children}
      </PrivyProvider>
    );
  }

  return children;
}

function PrivySessionLogoutRegistration() {
  const { logout } = usePrivy();
  const logoutSession = useCallback(() => logout(), [logout]);
  useProviderSessionLogoutRegistration("privy", logoutSession);
  return null;
}

function toWebSocketRpcUrl(rpcUrl: string) {
  if (rpcUrl.startsWith("https://")) {
    return `wss://${rpcUrl.slice("https://".length)}`;
  }

  if (rpcUrl.startsWith("http://")) {
    return `ws://${rpcUrl.slice("http://".length)}`;
  }

  return rpcUrl;
}
