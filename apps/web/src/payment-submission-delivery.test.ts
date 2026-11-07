import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiMutationError } from "./api-mutation-types";
import {
  deliverPendingPaymentSubmission,
  type PaymentSubmissionDeliveryDependencies
} from "./payment-submission-delivery";
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
    }, { now: () => Date.parse("2026-11-06T12:01:00.000Z") })).resolves.toBe("accepted");

    expect(submitSignature).toHaveBeenCalledTimes(2);
    expect(submitSignature.mock.calls[0]?.[0]).toEqual({
      intentId: record.intentId,
      signature: record.signature,
      signedTransactionBase64: record.signedTransactionBase64,
      idempotencyKey: record.idempotencyKey
    });
    expect(submitSignature.mock.calls[1]?.[0]).toEqual({
      intentId: record.intentId,
      signature: record.signature,
      signedTransactionBase64: record.signedTransactionBase64,
      idempotencyKey: record.idempotencyKey
    });
    expect(submitSignature.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(submitSignature.mock.calls[1]?.[1].signal).toBe(
      submitSignature.mock.calls[0]?.[1].signal
    );
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
    expect(broadcastSignedTransaction.mock.calls[0]?.[0]).toBe(record.signedTransactionBase64);
    expect(broadcastSignedTransaction.mock.calls[0]?.[1].signal).toBe(
      submitSignature.mock.calls[0]?.[1].signal
    );
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

  it("classifies pre-broadcast transaction validation rejection as an invalid recovery record", async () => {
    const submitSignature = vi.fn().mockRejectedValue(
      new ApiMutationError("Signed transaction is invalid", 400)
    );
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    })).resolves.toBe("invalid");
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("keeps a broadcast timeout uncertain and retries only API acceptance", async () => {
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const broadcastSignedTransaction = vi.fn().mockRejectedValue(new Error("RPC timeout"));

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, { now: () => Date.parse("2026-11-06T12:01:00.000Z") })).resolves.toBe("uncertain");
    expect(submitSignature).toHaveBeenCalledTimes(2);
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
  });

  it("never rebroadcasts an expired signed transaction but still submits it for reconciliation", async () => {
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, { now: () => Date.parse("2027-01-02T00:00:00.000Z") })).resolves.toBe("accepted_expired");
    expect(submitSignature).toHaveBeenCalledOnce();
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("re-reads the clock after acceptance and does not broadcast at the expiry boundary", async () => {
    const record = paymentRecord();
    const events: string[] = [];
    let currentTime = Date.parse("2026-12-31T23:59:59.999Z");
    const submitSignature = vi.fn(async () => {
      events.push("acceptance-finished");
      currentTime = Date.parse(record.intentExpiresAt);
    });
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(record, {
      submitSignature,
      broadcastSignedTransaction
    }, {
      now: () => {
        events.push("clock-read");
        return currentTime;
      }
    })).resolves.toBe("accepted_expired");

    expect(events).toEqual(["acceptance-finished", "clock-read"]);
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("bounds a submission whose acceptance transport never settles", async () => {
    vi.useFakeTimers();
    const submitSignature = vi.fn<PaymentSubmissionDeliveryDependencies["submitSignature"]>(
      () => new Promise<void>(() => undefined)
    );
    const broadcastSignedTransaction = vi.fn();

    const delivery = deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      totalTimeoutMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(delivery).resolves.toBe("uncertain");
    expect(submitSignature).toHaveBeenCalledOnce();
    expect(submitSignature.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("bounds a broadcast whose RPC acknowledgement never settles", async () => {
    vi.useFakeTimers();
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const broadcastSignedTransaction = vi.fn(() => new Promise<string>(() => undefined));

    const delivery = deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      totalTimeoutMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(delivery).resolves.toBe("uncertain");
    expect(submitSignature).toHaveBeenCalledOnce();
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
  });

  it("accepts delayed API and RPC acknowledgements that finish inside the one total deadline", async () => {
    vi.useFakeTimers();
    const record = paymentRecord();
    const submitSignature = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 10))
    );
    const broadcastSignedTransaction = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve(record.signature), 10))
    );

    const delivery = deliverPendingPaymentSubmission(record, {
      submitSignature,
      broadcastSignedTransaction
    }, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      totalTimeoutMs: 50
    });

    await vi.advanceTimersByTimeAsync(30);
    await expect(delivery).resolves.toBe("accepted");
    expect(submitSignature).toHaveBeenCalledTimes(2);
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce();
  });

  it("cancels a mounted recovery attempt through the same signal without changing its payload", async () => {
    const record = paymentRecord();
    const controller = new AbortController();
    const submitSignature = vi.fn<PaymentSubmissionDeliveryDependencies["submitSignature"]>(
      () => new Promise<void>(() => undefined)
    );
    const broadcastSignedTransaction = vi.fn();

    const delivery = deliverPendingPaymentSubmission(record, {
      submitSignature,
      broadcastSignedTransaction
    }, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      signal: controller.signal
    });
    controller.abort();

    await expect(delivery).resolves.toBe("uncertain");
    expect(submitSignature.mock.calls[0]?.[0]).toEqual({
      intentId: record.intentId,
      signature: record.signature,
      signedTransactionBase64: record.signedTransactionBase64,
      idempotencyKey: record.idempotencyKey
    });
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it("does not invoke a transport when its parent attempt was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Recovery attempt unmounted"));
    const submitSignature = vi.fn();
    const broadcastSignedTransaction = vi.fn();

    await expect(deliverPendingPaymentSubmission(paymentRecord(), {
      submitSignature,
      broadcastSignedTransaction
    }, { signal: controller.signal })).resolves.toBe("uncertain");

    expect(submitSignature).not.toHaveBeenCalled();
    expect(broadcastSignedTransaction).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
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
