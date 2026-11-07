export const paymentOperationTimeoutMs = 10_000;

export interface PaymentOperationDeadlineOptions {
  signal?: AbortSignal | undefined;
  totalTimeoutMs?: number;
}

/**
 * Applies one wall-clock budget to a payment operation, including response-body consumption. The
 * promise race is intentional: callers still make progress when a dependency does not observe the
 * AbortSignal, while compatible fetch/RPC adapters receive the same signal and can stop their work.
 */
export async function runPaymentOperationWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: PaymentOperationDeadlineOptions = {}
): Promise<T> {
  const deadline = createPaymentOperationDeadline(
    options.signal,
    options.totalTimeoutMs ?? paymentOperationTimeoutMs
  );

  try {
    if (deadline.signal.aborted) {
      throw deadline.signal.reason ?? new Error("Payment operation cancelled");
    }
    return await waitForPaymentOperation(operation(deadline.signal), deadline.signal);
  } finally {
    deadline.dispose();
  }
}

export function createPaymentOperationDeadline(
  parentSignal: AbortSignal | undefined,
  totalTimeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Payment operation deadline exceeded"));
  }, Math.max(0, totalTimeoutMs));
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new Error("Payment operation cancelled"));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

export function waitForPaymentOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Payment operation cancelled"));
  }

  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      reject(signal.reason ?? new Error("Payment operation cancelled"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}
