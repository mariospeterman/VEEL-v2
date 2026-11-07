export const PAYMENT_PROJECTION_REFRESH_ATTEMPTS = 15;
export const PAYMENT_PROJECTION_REFRESH_INTERVAL_MS = 2_000;

export type PaymentProjectionCheckoutState = "confirmed" | "awaiting_projection";

export function paymentProjectionCheckoutState(
  paymentState: string,
  hasProjectionRefresh: boolean
): PaymentProjectionCheckoutState | null {
  if (paymentState !== "confirmed" && paymentState !== "settled") return null;
  return hasProjectionRefresh ? "awaiting_projection" : "confirmed";
}

interface RefreshPaymentProjectionOptions {
  attempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export async function refreshPaymentProjection(
  refresh: () => void | Promise<void>,
  options: RefreshPaymentProjectionOptions = {}
): Promise<"cancelled" | "exhausted"> {
  const attempts = options.attempts ?? PAYMENT_PROJECTION_REFRESH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? PAYMENT_PROJECTION_REFRESH_INTERVAL_MS;
  const wait = options.wait ?? waitForRetry;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) return "cancelled";

    try {
      await refresh();
    } catch {
      // A projection refresh failure must not reclassify a verified payment as failed.
    }

    if (options.signal?.aborted) return "cancelled";
    if (attempt + 1 < attempts) await wait(intervalMs, options.signal);
  }

  return options.signal?.aborted ? "cancelled" : "exhausted";
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
}
