"use client";

import { embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";
import { SolanaWalletProvider } from "@/wallet/solana-wallet-provider";
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
    <SolanaWalletProvider>
      <div className="landing-wallet-runtime" aria-label="Wallet providers" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
        <p className="landing-wallet-required">Required. Connect a Solana wallet and sign the backend ownership challenge.</p>
        <div className="landing-wallet-connect-row">
          <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
        </div>
        <div className="landing-embedded-wallets" aria-label="Embedded wallet providers">
          <div className="landing-embedded-label">
            <p>Embedded wallet</p>
            <span>{embeddedWallets.enabled ? "Optional provider setup can be added after access is created." : "Provider login is waiting for runtime configuration."}</span>
          </div>
          {embeddedWallets.providers.map((provider) => (
            <button className="landing-provider-disabled" disabled key={provider.provider} type="button">
              <strong>{provider.label}</strong>
              <small>{provider.configured ? "Add later" : "Not configured"}</small>
            </button>
          ))}
        </div>
      </div>
    </SolanaWalletProvider>
  );
}
