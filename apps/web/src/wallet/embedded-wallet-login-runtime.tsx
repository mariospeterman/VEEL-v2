"use client";

import { EmbeddedWalletLoginMethods } from "./embedded-wallet-login";
import type { EmbeddedAuthMethod } from "./embedded-auth-method";
import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import type { WalletAuthPurpose } from "./backend-wallet-auth";

export function EmbeddedWalletLoginRuntime({
  initialMethod,
  onAccountNotFound,
  onLinked,
  purpose,
  secondary
}: {
  initialMethod: EmbeddedAuthMethod;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  secondary: boolean;
}) {
  return (
    <EmbeddedWalletProviders purpose={purpose}>
      <EmbeddedWalletLoginMethods
        initialMethod={initialMethod}
        onAccountNotFound={onAccountNotFound}
        onLinked={onLinked}
        purpose={purpose}
        secondary={secondary}
      />
    </EmbeddedWalletProviders>
  );
}
