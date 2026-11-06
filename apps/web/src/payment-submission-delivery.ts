import { ApiMutationError } from "./api-mutation-types";
import type { PendingPaymentSubmission } from "./payment-submission-recovery";

export type PaymentSubmissionDeliveryResult =
  | "accepted"
  | "accepted_expired"
  | "blocked"
  | "uncertain";

export interface PaymentSubmissionDeliveryDependencies {
  submitSignature(input: {
    intentId: string;
    signature: string;
    idempotencyKey: string;
  }): Promise<void>;
  broadcastSignedTransaction(signedTransactionBase64: string): Promise<string>;
}

/**
 * Replays only the exact wallet-authorized bytes and command key. Re-running this function after an
 * acknowledgement loss is safe: Solana identifies the transaction by its embedded first signature,
 * while the API command is idempotent for the same actor, intent, key, and signature.
 */
export async function deliverPendingPaymentSubmission(
  record: PendingPaymentSubmission,
  dependencies: PaymentSubmissionDeliveryDependencies,
  now = Date.now()
): Promise<PaymentSubmissionDeliveryResult> {
  const firstAcceptance = await submitForAcceptance(record, dependencies);
  if (firstAcceptance === "blocked") return "blocked";

  const expired = Date.parse(record.intentExpiresAt) <= now;
  if (expired) {
    return firstAcceptance === "accepted" ? "accepted_expired" : "uncertain";
  }

  let broadcastUncertain = false;
  try {
    const rpcSignature = await dependencies.broadcastSignedTransaction(
      record.signedTransactionBase64
    );
    if (rpcSignature !== record.signature) broadcastUncertain = true;
  } catch {
    // sendTransaction/sendRawTransaction can fail after the RPC accepted the bytes. The exact raw
    // transaction remains the only retry path; never replace it with a new wallet approval here.
    broadcastUncertain = true;
  }

  const postBroadcastAcceptance = await submitForAcceptance(record, dependencies);
  if (postBroadcastAcceptance === "blocked") {
    return broadcastUncertain ? "uncertain" : "blocked";
  }

  return broadcastUncertain || postBroadcastAcceptance === "uncertain"
    ? "uncertain"
    : "accepted";
}

async function submitForAcceptance(
  record: PendingPaymentSubmission,
  dependencies: PaymentSubmissionDeliveryDependencies
): Promise<"accepted" | "blocked" | "uncertain"> {
  try {
    await dependencies.submitSignature({
      intentId: record.intentId,
      signature: record.signature,
      idempotencyKey: record.idempotencyKey
    });
    return "accepted";
  } catch (error) {
    return isDefinitiveAcceptanceRejection(error) ? "blocked" : "uncertain";
  }
}

function isDefinitiveAcceptanceRejection(error: unknown): boolean {
  if (!(error instanceof ApiMutationError) || error.status === undefined) return false;
  return [400, 401, 403, 404, 409, 410, 422].includes(error.status);
}
