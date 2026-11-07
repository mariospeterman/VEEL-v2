import { afterEach, describe, expect, it, vi } from "vitest";
import { coalescePaymentBroadcast } from "./payment-broadcast-coalescing";
import { deliverPendingPaymentSubmission } from "./payment-submission-delivery";
import type { PendingPaymentSubmission } from "./payment-submission-recovery";

describe("non-abortable Solana payment broadcasts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces one exact signature without blocking a different transaction", async () => {
    installGlobalLockManager();
    let resolveFirstBroadcast!: (signature: string) => void;
    const firstOperation = new Promise<string>((resolve) => {
      resolveFirstBroadcast = resolve;
    });
    const firstBroadcast = vi.fn().mockReturnValue(firstOperation);
    const secondBroadcast = vi.fn().mockResolvedValue("signature-2");

    const first = coalescePaymentBroadcast("signature-1", firstBroadcast);
    const concurrentSameSignature = coalescePaymentBroadcast(
      "signature-1",
      firstBroadcast
    );
    const concurrentDifferentSignature = coalescePaymentBroadcast(
      "signature-2",
      secondBroadcast
    );

    await expect(concurrentSameSignature).rejects.toThrow("already in flight");
    await expect(concurrentDifferentSignature).resolves.toBe("signature-2");
    expect(firstBroadcast).toHaveBeenCalledOnce();
    expect(secondBroadcast).toHaveBeenCalledOnce();

    resolveFirstBroadcast("signature-1");
    await expect(first).resolves.toBe("signature-1");

    firstBroadcast.mockResolvedValueOnce("signature-1");
    await expect(coalescePaymentBroadcast("signature-1", firstBroadcast))
      .resolves.toBe("signature-1");
    expect(firstBroadcast).toHaveBeenCalledTimes(2);
  });

  it("releases a truly hung owner at the caller deadline and later replays the same bytes", async () => {
    vi.useFakeTimers();
    installGlobalLockManager();
    const record = paymentRecord();
    const submitSignature = vi.fn().mockResolvedValue(undefined);
    const sendRawTransaction = vi.fn()
      .mockImplementationOnce(() => new Promise<string>(() => undefined))
      .mockResolvedValueOnce(record.signature);
    const dependencies = {
      submitSignature,
      broadcastSignedTransaction(signedTransactionBase64: string, options: { signal: AbortSignal }) {
        expect(signedTransactionBase64).toBe(record.signedTransactionBase64);
        return coalescePaymentBroadcast(
          record.signature,
          sendRawTransaction,
          { signal: options.signal, ownershipTimeoutMs: 1_000 }
        );
      }
    };

    const first = deliverPendingPaymentSubmission(record, dependencies, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      totalTimeoutMs: 25
    });
    await vi.advanceTimersByTimeAsync(25);
    await expect(first).resolves.toBe("uncertain");

    const retry = deliverPendingPaymentSubmission(record, dependencies, {
      now: () => Date.parse("2026-11-06T12:01:00.000Z"),
      totalTimeoutMs: 25
    });
    await expect(retry).resolves.toBe("accepted");

    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(submitSignature).toHaveBeenCalledTimes(3);
    expect(new Set(submitSignature.mock.calls.map(([input]) => input.signature)))
      .toEqual(new Set([record.signature]));
  });

  it("fails closed without browser-wide lock ownership", async () => {
    vi.stubGlobal("navigator", {});
    const sendRawTransaction = vi.fn().mockResolvedValue("signature-1");

    await expect(coalescePaymentBroadcast(
      "signature-1",
      sendRawTransaction
    )).rejects.toThrow("ownership is unavailable");
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});

function installGlobalLockManager() {
  const held = new Set<string>();
  const request = vi.fn(async (
    name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => Promise<string> | string
  ) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try {
      return await callback({ mode: "exclusive", name } as Lock);
    } finally {
      held.delete(name);
    }
  });
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

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
