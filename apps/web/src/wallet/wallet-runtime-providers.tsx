"use client";

import { EmbeddedWalletProviders } from "./embedded-wallet-providers";
import { WalletRuntimeBaseProviders } from "./wallet-runtime-base-providers";

export function WalletRuntimeProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <WalletRuntimeBaseProviders>
      <EmbeddedWalletProviders>{children}</EmbeddedWalletProviders>
    </WalletRuntimeBaseProviders>
  );
}
