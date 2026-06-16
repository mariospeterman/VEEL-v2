"use client";

import type { WebAuthState } from "@/supabase/auth-state";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";

interface EnterWalletPanelProps {
  authState: WebAuthState;
  compact?: boolean;
}

export function EnterWalletPanel({ authState, compact = false }: EnterWalletPanelProps) {
  const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const turnkeyConfigured = Boolean(process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID);

  return (
    <div className="auth-wallet-panel">
      <WalletLinkPanel authState={authState} compact={compact} />
      <div className="auth-wallet-provider-grid">
        <ProviderState
          configured={privyConfigured}
          label="Privy embedded wallet"
          note="Non-custodial embedded wallet option for users without an existing Solana wallet."
        />
        <ProviderState
          configured={turnkeyConfigured}
          label="Turnkey wallet kit"
          note="Embedded wallet kit for passkey-based user-controlled Solana wallets."
        />
      </div>
    </div>
  );
}

function ProviderState({
  configured,
  label,
  note
}: {
  configured: boolean;
  label: string;
  note: string;
}) {
  return (
    <div className="auth-wallet-option" data-state={configured ? "configured" : "pending"}>
      <strong>{label}</strong>
      <span>{configured ? "Configured for this environment. Use wallet connect above to create the backend session." : note}</span>
    </div>
  );
}
