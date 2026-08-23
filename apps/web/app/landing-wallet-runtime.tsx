"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLauncher } from "@/wallet/embedded-wallet-launcher";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";
import { WalletRuntimeBaseProviders } from "@/wallet/wallet-runtime-base-providers";
import type { WalletAuthPurpose } from "@/wallet/backend-wallet-auth";

export function LandingWalletRuntime({
  autoStart,
  authState,
  onAccountNotFound,
  onLinked,
  purpose
}: {
  autoStart?: boolean;
  authState: WebAuthState;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
}) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());

  return (
    <WalletRuntimeBaseProviders>
      <div className="landing-wallet-runtime" aria-label="Wallet sign in" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
        <div className="landing-wallet-connect-row">
          <WalletLinkPanel
            authPurpose={purpose}
            autoStart={Boolean(autoStart)}
            authState={authState}
            compact
            key={purpose}
            loginSimple
            onAccountNotFound={onAccountNotFound}
            onLinked={onLinked}
            reloadOnSession={!onLinked}
          />
        </div>
        {embeddedWallets.provider.configured ? (
          <EmbeddedWalletLauncher
            label={purpose === "login" ? "Use another sign-in method" : "Create secure WeVid wallet"}
            onAccountNotFound={onAccountNotFound}
            onLinked={onLinked}
            purpose={purpose}
            secondary
          />
        ) : null}
      </div>
    </WalletRuntimeBaseProviders>
  );
}
