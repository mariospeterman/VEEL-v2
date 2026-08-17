"use client";

import { EmbeddedWalletLoginButton } from "./embedded-wallet-login";
import { EmbeddedWalletProviders } from "./embedded-wallet-providers";

export function EmbeddedWalletLoginRuntime({
  label,
  onLinked,
  secondary
}: {
  label: string;
  onLinked?: ((address: string) => void) | undefined;
  secondary: boolean;
}) {
  return (
    <EmbeddedWalletProviders>
      <EmbeddedWalletLoginButton autoStart label={label} onLinked={onLinked} secondary={secondary} />
    </EmbeddedWalletProviders>
  );
}
