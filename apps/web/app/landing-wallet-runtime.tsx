"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLauncher } from "@/wallet/embedded-wallet-launcher";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";
import { WalletRuntimeBaseProviders } from "@/wallet/wallet-runtime-base-providers";

export function LandingWalletRuntime({
  authState,
  onLinked
}: {
  authState: WebAuthState;
  onLinked?: ((address: string) => void) | undefined;
}) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());

  return (
    <WalletRuntimeBaseProviders>
      <div className="landing-wallet-runtime" aria-label="Wallet sign in" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
        <div className="landing-wallet-connect-row">
          <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
        </div>
        {embeddedWallets.provider.configured ? (
          <EmbeddedWalletLauncher label="Create secure WeVid wallet" onLinked={onLinked} secondary />
        ) : null}
      </div>
    </WalletRuntimeBaseProviders>
  );
}
