"use client";

import type { TransactionRequest } from "@/api-mutations";
import type {
  PaymentSubmissionQuoteSnapshot,
  PendingPaymentSubmission
} from "@/payment-submission-recovery";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";
import { PaymentWalletBridge } from "./payment-wallet-bridge";

export function PaymentWalletRuntime(props: {
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: (record: PendingPaymentSubmission) => void;
  quote: PaymentSubmissionQuoteSnapshot | null;
  recoveryScope: string;
  request: TransactionRequest | null;
}) {
  return (
    <WalletRuntimeProviders>
      <PaymentWalletBridge {...props} />
    </WalletRuntimeProviders>
  );
}
