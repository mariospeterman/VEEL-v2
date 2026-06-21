"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  TurnkeyProvider,
  type TurnkeyProviderConfig
} from "@turnkey/react-wallet-kit";
import { parsePublicWebEnv } from "@veel/config/public";
import { useMemo } from "react";

export function EmbeddedWalletProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  const env = parsePublicWebEnv(process.env);
  const solanaChain = env.NEXT_PUBLIC_SOLANA_CHAIN;
  const solanaRpcUrl = env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const solanaSubscriptionsUrl = env.NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL ?? toWebSocketRpcUrl(solanaRpcUrl);

  const privyConfig = useMemo<PrivyClientConfig>(
    () => ({
      appearance: {
        accentColor: "#20eaa4",
        landingHeader: "Enter WeVid",
        loginMessage: "Unlock your embedded Solana wallet.",
        showWalletLoginFirst: true,
        theme: "dark",
        walletChainType: "solana-only"
      },
      embeddedWallets: {
        solana: {
          createOnLogin: "users-without-wallets"
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
    [solanaChain, solanaRpcUrl, solanaSubscriptionsUrl]
  );

  const turnkeyConfig = useMemo<TurnkeyProviderConfig | null>(() => {
    if (!env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID) {
      return null;
    }

    return {
      apiBaseUrl: env.NEXT_PUBLIC_TURNKEY_API_BASE_URL,
      auth: {
        autoRefreshSession: true
      },
      authProxyConfigId: env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID,
      authProxyUrl: env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_URL,
      organizationId: env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID,
      ui: {
        authModal: {
          methodOrder: ["passkey", "email", "socials"],
          methods: {
            discordOauthEnabled: true,
            emailOtpAuthEnabled: true,
            googleOauthEnabled: true,
            passkeyAuthEnabled: true,
            walletAuthEnabled: false,
            xOauthEnabled: true
          },
          oauthOrder: ["google", "discord", "x"]
        },
        darkMode: true,
        renderModalInProvider: true,
        supressMissingStylesError: false
      }
    };
  }, [env.NEXT_PUBLIC_TURNKEY_API_BASE_URL, env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID, env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_URL, env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID]);

  let tree = children;

  if (turnkeyConfig) {
    tree = <TurnkeyProvider config={turnkeyConfig}>{tree}</TurnkeyProvider>;
  }

  if (env.NEXT_PUBLIC_PRIVY_APP_ID) {
    tree = (
      <PrivyProvider appId={env.NEXT_PUBLIC_PRIVY_APP_ID} config={privyConfig}>
        {tree}
      </PrivyProvider>
    );
  }

  return tree;
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
