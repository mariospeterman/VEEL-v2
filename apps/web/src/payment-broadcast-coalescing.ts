const paymentBroadcastOwnershipLockPrefix = "wevid:payment-broadcast:signature-v2:";

export const paymentBroadcastOwnershipTimeoutMs = 10_000;

export interface PaymentBroadcastOwnershipOptions {
  signal?: AbortSignal;
  ownershipTimeoutMs?: number;
}

/**
 * Solana web3.js sendRawTransaction does not accept an AbortSignal. Ownership is therefore scoped
 * to the transaction's exact first signature and released when the caller's deadline expires (or
 * after the bounded fallback lease). A later attempt may safely replay only those same signed bytes:
 * Solana identifies them by the same signature, so this cannot authorize a second debit.
 */
export function coalescePaymentBroadcast(
  signature: string,
  broadcast: () => Promise<string>,
  options: PaymentBroadcastOwnershipOptions = {}
): Promise<string> {
  const lockManager = typeof navigator === "undefined" ? null : navigator.locks;
  if (!lockManager?.request) {
    return Promise.reject(new Error("Payment broadcast ownership is unavailable"));
  }

  const lockName = `${paymentBroadcastOwnershipLockPrefix}${signature}`;
  // lib.dom models the callback's promise as T, producing Promise<Promise<string>>. Native promise
  // adoption flattens the value while the callback controls the bounded ownership lifetime.
  return lockManager.request<Promise<string>>(
    lockName,
    { ifAvailable: true, mode: "exclusive" },
    (lock) => {
      if (!lock) {
        throw new Error(`Payment broadcast already in flight (${signature})`);
      }

      return holdPaymentBroadcastOwnership(broadcast(), options);
    }
  ) as unknown as Promise<string>;
}

function holdPaymentBroadcastOwnership(
  operation: Promise<string>,
  options: PaymentBroadcastOwnershipOptions
): Promise<string> {
  const ownershipTimeoutMs = Math.max(
    0,
    options.ownershipTimeoutMs ?? paymentBroadcastOwnershipTimeoutMs
  );

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", releaseForCaller);
      callback();
    };
    const releaseForCaller = () => {
      finish(() => reject(
        options.signal?.reason ?? new Error("Payment broadcast ownership deadline exceeded")
      ));
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Payment broadcast ownership lease expired")));
    }, ownershipTimeoutMs);

    if (options.signal?.aborted) {
      releaseForCaller();
      return;
    }
    options.signal?.addEventListener("abort", releaseForCaller, { once: true });
    operation.then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error))
    );
  });
}
