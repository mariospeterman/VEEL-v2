"use client";

import type { TransactionRequest } from "@/api-mutations";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";
import { PaymentWalletBridge } from "./payment-wallet-bridge";

export function PaymentWalletRuntime(props: {
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: () => void;
  request: TransactionRequest;
}) {
  return (
    <WalletRuntimeProviders>
      <PaymentWalletBridge {...props} />
    </WalletRuntimeProviders>
  );
}
