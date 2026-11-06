import { describe, expect, it, vi } from "vitest";
import { ApiMutationError } from "./api-mutation-types";
import { deliverPendingPaymentSubmission } from "./payment-submission-delivery";
import type { PendingPaymentSubmission } from "./payment-submission-recovery";

describe("signed payment submission delivery", () => {
  it("reuses one signature, command key, and raw transaction after a lost API acknowledgement", async () => {
    const record = paymentRecord();
    const submitSignature = vi.fn()
      .mockRejectedValueOnce(new ApiMutationError("API is unavailable", 503))
      .mockResolvedValueOnce(undefined);
    const broadcastSignedTransaction = vi.fn().mockResolvedValue(record.signature);

    await expect(deliverPendingPaymentSubmission(record, {
      submitSignature,
      broadcastSignedTransaction
    }, Date.parse("2026-11-06T12:01:00.000Z"))).resolves.toBe("accepted");

    expect(submitSignature).toHaveBeenCalledTimes(2);
    expect(submitSignature).toHaveBeenNthCalledWith(1, {
      intentId: record.intentId,
      signature: record.signature,
      idempotencyKey: record.idempotencyKey
    });
    expect(submitSignature).toHaveBeenNthCalledWith(2, {
      intentId: record.intentId,
      signature: record.signature,
      idempotencyKey: record.idempotencyKey
    });
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
    expect(broadcastSignedTransaction).toHaveBeenCalledWith(record.signedTransactionBase64);
  });

  it("does not broadcast when the backend definitively rejects the retained signature", async () => {
    const submitSignature = vi.fn().mockRejectedValue(
      new ApiMutationError("A different submission exists", 409)
    );
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    })).resolves.toBe("blocked");
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("keeps a broadcast timeout uncertain and retries only API acceptance", async () => {
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const broadcastSignedTransaction = vi.fn().mockRejectedValue(new Error("RPC timeout"));

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, Date.parse("2026-11-06T12:01:00.000Z"))).resolves.toBe("uncertain");
    expect(submitSignature).toHaveBeenCalledTimes(2);
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
  });

  it("never rebroadcasts an expired signed transaction but still submits it for reconciliation", async () => {
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, Date.parse("2027-01-02T00:00:00.000Z"))).resolves.toBe("accepted_expired");
    expect(submitSignature).toHaveBeenCalledOnce();
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });
});

function paymentRecord(): PendingPaymentSubmission {
  return {
    schemaVersion: 1,
    actorUserId: "00000000-0000-4000-8000-000000000001",
    clientSessionScope: "a".repeat(43),
    recoveryScope: "content_unlock:00000000-0000-4000-8000-000000000010",
    intentId: "00000000-0000-4000-8000-000000000011",
    walletAddress: "1".repeat(32),
    quote: {
      productType: "content_unlock",
      amountMinor: 100,
      currency: "USDC",
      settlementKind: "creator_split",
      creatorSideProceedsMinor: 90,
      creatorAmountMinor: 90,
      enterpriseManagementAmountMinor: 0,
      platformFeeGrossMinor: 10,
      platformFeeAmountMinor: 8,
      referralAmountMinor: 2,
      minimumAmountMinor: 1,
      platformFeeBps: 1_000,
      referralShareOfPlatformFeeBps: 2_000,
      quotedAt: "2026-11-06T12:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      policySource: "environment_default",
      policyRevision: 1,
      termsVersion: "checkout-v1",
      withdrawalWaiverVersion: "waiver-v1"
    },
    signature: "1".repeat(88),
    signedTransactionBase64: "b25l",
    idempotencyKey: "payment-command-1",
    intentExpiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-11-06T12:00:00.000Z"
  };
}
