"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLoginButton } from "@/wallet/embedded-wallet-login";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";

export function LandingWalletRuntime({
  authState,
  onLinked
}: {
  authState: WebAuthState;
  onLinked?: ((address: string) => void) | undefined;
}) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());

  return (
    <div className="landing-wallet-runtime" aria-label="Wallet providers" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
      <p className="landing-wallet-required">Choose how to continue. Your wallet stays under your control.</p>
      {embeddedWallets.provider.configured ? (
        <EmbeddedWalletLoginButton label="Continue" onLinked={onLinked} />
      ) : null}
      <div className="landing-wallet-connect-row">
        <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
      </div>
    </div>
  );
}
