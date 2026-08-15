"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLoginButton } from "@/wallet/embedded-wallet-login";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";

export function LandingWalletRuntime({
  authState,
  entry,
  onLinked
}: {
  authState: WebAuthState;
  entry: "account" | "wallet";
  onLinked?: ((address: string) => void) | undefined;
}) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());

  return (
    <WalletRuntimeProviders>
      <div className="landing-wallet-runtime" aria-label="Wallet providers" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
        <p className="landing-wallet-required">
          {entry === "account" ? "Sign in once, then confirm wallet ownership." : "Connect your Solana wallet and confirm ownership."}
        </p>
        {entry === "wallet" ? (
          <div className="landing-wallet-connect-row">
            <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
          </div>
        ) : embeddedWallets.provider.configured ? (
          <EmbeddedWalletLoginButton label="Continue" onLinked={onLinked} />
        ) : (
          <button className="landing-provider-disabled" disabled type="button">
            <strong>Account sign-in unavailable</strong>
            <small>Provider configuration required</small>
          </button>
        )}
      </div>
    </WalletRuntimeProviders>
  );
}
