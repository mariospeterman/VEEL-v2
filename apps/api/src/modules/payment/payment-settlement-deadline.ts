import type {
  PaymentSettlementInput,
  PaymentSettlementResult,
  PaymentSettlementVerifier
} from "./types.js";

export const immediatePaymentSettlementVerificationTimeoutMs = 10_000;

export async function verifyPaymentSettlementWithinDeadline(
  verifier: PaymentSettlementVerifier,
  input: PaymentSettlementInput,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<PaymentSettlementResult> {
  return runPaymentVerificationWithinDeadline(
    (signal) => verifier.verifyTransfer(input, { signal }),
    options
  );
}

export async function verifyPaymentTransactionExpiryWithinDeadline(
  verifier: PaymentSettlementVerifier,
  input: {
    signature: string;
    signedTransactionBase64: string;
    buyerWallet: string | null;
  },
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<
  | { state: "expired" }
  | { state: "active" | "observed" | "invalid" }
> {
  if (!verifier.verifyTransactionExpiry) {
    throw new Error("Payment transaction expiry verification is unavailable");
  }

  return runPaymentVerificationWithinDeadline(
    (signal) => verifier.verifyTransactionExpiry!(input, { signal }),
    options
  );
}

async function runPaymentVerificationWithinDeadline<T>(
  verify: (signal: AbortSignal) => Promise<T>,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Immediate payment settlement verification deadline exceeded"));
  }, Math.max(0, options.timeoutMs ?? immediatePaymentSettlementVerificationTimeoutMs));
  const abortFromParent = () => {
    controller.abort(options.signal?.reason ?? new Error("Payment settlement verification cancelled"));
  };

  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("Payment settlement verification cancelled");
    }
    return await waitForPaymentVerification(
      verify(controller.signal),
      controller.signal
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

function waitForPaymentVerification<T>(
  verification: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      reject(signal.reason ?? new Error("Payment settlement verification cancelled"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    verification.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}
