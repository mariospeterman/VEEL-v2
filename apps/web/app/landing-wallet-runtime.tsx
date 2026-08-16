"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLoginButton } from "@/wallet/embedded-wallet-login";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";

export function LandingWalletRuntime({
  authState,
  onLinked
}: {
  authState: WebAuthState;
  onLinked?: ((address: string) => void) | undefined;
}) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());

  return (
    <WalletRuntimeProviders>
      <div className="landing-wallet-runtime" aria-label="Wallet sign in" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
        <div className="landing-wallet-connect-row">
          <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
        </div>
        {embeddedWallets.provider.configured ? (
          <EmbeddedWalletLoginButton label="Create secure WeVid wallet" onLinked={onLinked} secondary />
        ) : null}
      </div>
    </WalletRuntimeProviders>
  );
}
