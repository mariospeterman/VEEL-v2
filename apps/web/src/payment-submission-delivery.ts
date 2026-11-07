import { ApiMutationError } from "./api-mutation-types";
import {
  createPaymentOperationDeadline,
  paymentOperationTimeoutMs,
  waitForPaymentOperation
} from "./payment-operation-deadline";
import type { PendingPaymentSubmission } from "./payment-submission-recovery";

export type PaymentSubmissionDeliveryResult =
  | "accepted"
  | "accepted_expired"
  | "blocked"
  | "invalid"
  | "uncertain";

export interface PaymentSubmissionDeliveryDependencies {
  submitSignature(input: {
    intentId: string;
    signature: string;
    signedTransactionBase64: string;
    idempotencyKey: string;
  }, options: { signal: AbortSignal }): Promise<void>;
  broadcastSignedTransaction(
    signedTransactionBase64: string,
    options: { signal: AbortSignal }
  ): Promise<string>;
}

export interface PaymentSubmissionDeliveryOptions {
  now?: () => number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
}

export const paymentSubmissionDeliveryTimeoutMs = paymentOperationTimeoutMs;

/**
 * Replays only the exact wallet-authorized bytes and command key. Re-running this function after an
 * acknowledgement loss is safe: Solana identifies the transaction by its embedded first signature,
 * while the API command is idempotent for the same actor, intent, key, and signature.
 */
export async function deliverPendingPaymentSubmission(
  record: PendingPaymentSubmission,
  dependencies: PaymentSubmissionDeliveryDependencies,
  options: PaymentSubmissionDeliveryOptions = {}
): Promise<PaymentSubmissionDeliveryResult> {
  const deadline = createPaymentOperationDeadline(
    options.signal,
    options.totalTimeoutMs ?? paymentSubmissionDeliveryTimeoutMs
  );

  try {
    const firstAcceptance = await submitForAcceptance(record, dependencies, deadline.signal);
    if (firstAcceptance === "blocked" || firstAcceptance === "invalid") {
      return firstAcceptance;
    }
    if (deadline.signal.aborted) return "uncertain";

    // Acceptance may take long enough to cross the transaction/intent boundary. Read the clock
    // only after that acknowledgement and immediately before any RPC broadcast is considered.
    const expired = Date.parse(record.intentExpiresAt) <= (options.now ?? Date.now)();
    if (expired) {
      return firstAcceptance === "accepted" ? "accepted_expired" : "uncertain";
    }

    let broadcastUncertain = false;
    try {
      const rpcSignature = await waitForPaymentOperation(
        dependencies.broadcastSignedTransaction(record.signedTransactionBase64, {
          signal: deadline.signal
        }),
        deadline.signal
      );
      if (rpcSignature !== record.signature) broadcastUncertain = true;
    } catch {
      // sendTransaction/sendRawTransaction can fail after the RPC accepted the bytes. The exact raw
      // transaction remains the only retry path; never replace it with a new wallet approval here.
      broadcastUncertain = true;
    }
    if (deadline.signal.aborted) return "uncertain";

    const postBroadcastAcceptance = await submitForAcceptance(
      record,
      dependencies,
      deadline.signal
    );
    // Once broadcast was attempted, even a later validation rejection cannot prove that the RPC
    // did not accept the bytes. Retain the exact transaction for canonical settlement polling.
    if (postBroadcastAcceptance === "invalid") return "uncertain";
    if (postBroadcastAcceptance === "blocked") {
      return broadcastUncertain ? "uncertain" : "blocked";
    }

    return broadcastUncertain || postBroadcastAcceptance === "uncertain"
      ? "uncertain"
      : "accepted";
  } finally {
    deadline.dispose();
  }
}

async function submitForAcceptance(
  record: PendingPaymentSubmission,
  dependencies: PaymentSubmissionDeliveryDependencies,
  signal: AbortSignal
): Promise<"accepted" | "blocked" | "invalid" | "uncertain"> {
  if (signal.aborted) return "uncertain";

  try {
    await waitForPaymentOperation(
      dependencies.submitSignature({
        intentId: record.intentId,
        signature: record.signature,
        signedTransactionBase64: record.signedTransactionBase64,
        idempotencyKey: record.idempotencyKey
      }, { signal }),
      signal
    );
    return "accepted";
  } catch (error) {
    return acceptanceRejection(error);
  }
}

function acceptanceRejection(error: unknown): "blocked" | "invalid" | "uncertain" {
  if (!(error instanceof ApiMutationError) || error.status === undefined) return "uncertain";
  if (error.status === 400 || error.status === 422) return "invalid";
  return [401, 403, 404, 409, 410].includes(error.status) ? "blocked" : "uncertain";
}
