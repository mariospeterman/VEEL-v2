"use client";

import { EmbeddedWalletLoginButton } from "./embedded-wallet-login";
import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import type { WalletAuthPurpose } from "./backend-wallet-auth";

export function EmbeddedWalletLoginRuntime({
  label,
  onAccountNotFound,
  onLinked,
  purpose,
  secondary
}: {
  label: string;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  secondary: boolean;
}) {
  return (
    <EmbeddedWalletProviders purpose={purpose}>
      <EmbeddedWalletLoginButton autoStart label={label} onAccountNotFound={onAccountNotFound} onLinked={onLinked} purpose={purpose} secondary={secondary} />
    </EmbeddedWalletProviders>
  );
}
