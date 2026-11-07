import { describe, expect, it } from "vitest";
import {
  applyPaymentSubmissionDeliveryResult,
  clearPaymentSubmissionRecovery,
  paymentSubmissionRecoveryKey,
  readPendingPaymentSubmission,
  storePendingPaymentSubmission,
  type PaymentRecoveryStorage,
  type PendingPaymentSubmission
} from "./payment-submission-recovery";

describe("payment submission browser recovery", () => {
  it("shares the exact signed submission across tabs without overwriting it", () => {
    const storage = new MemoryStorage();
    const first = paymentRecord();
    expect(storePendingPaymentSubmission(storage, first)).toEqual({
      record: first,
      storedNew: true
    });

    const secondTabCandidate = paymentRecord({
      intentId: "00000000-0000-4000-8000-000000000002",
      signature: "2".repeat(88),
      signedTransactionBase64: "dHdv"
    });
    expect(storePendingPaymentSubmission(storage, secondTabCandidate)).toEqual({
      record: first,
      storedNew: false
    });
    expect(readPendingPaymentSubmission(storage, first)).toEqual(first);
  });

  it("isolates recovery by actor and application-session scope", () => {
    const storage = new MemoryStorage();
    const record = paymentRecord();
    storePendingPaymentSubmission(storage, record);

    expect(readPendingPaymentSubmission(storage, {
      ...record,
      actorUserId: "00000000-0000-4000-8000-000000000099"
    })).toBeNull();
    expect(readPendingPaymentSubmission(storage, {
      ...record,
      clientSessionScope: "b".repeat(43)
    })).toBeNull();
    expect(readPendingPaymentSubmission(storage, record)).toEqual(record);
  });

  it("removes corrupt records and clears all retained payments on logout", () => {
    const storage = new MemoryStorage();
    const record = paymentRecord();
    storage.setItem(paymentSubmissionRecoveryKey(record), "{not-json");
    expect(readPendingPaymentSubmission(storage, record)).toBeNull();

    storePendingPaymentSubmission(storage, record);
    storage.setItem("unrelated", "keep");
    clearPaymentSubmissionRecovery(storage);
    expect(storage.getItem(paymentSubmissionRecoveryKey(record))).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("clears only a definitively invalid pre-broadcast record and retains uncertain recovery", () => {
    const storage = new MemoryStorage();
    const record = paymentRecord();
    storePendingPaymentSubmission(storage, record);

    expect(applyPaymentSubmissionDeliveryResult(storage, record, "uncertain")).toBe("retry");
    expect(readPendingPaymentSubmission(storage, record)).toEqual(record);

    expect(applyPaymentSubmissionDeliveryResult(storage, record, "invalid")).toBe("invalid");
    expect(readPendingPaymentSubmission(storage, record)).toBeNull();
  });
});

function paymentRecord(
  overrides: Partial<PendingPaymentSubmission> = {}
): PendingPaymentSubmission {
  return {
    schemaVersion: 1,
    actorUserId: "00000000-0000-4000-8000-000000000001",
    clientSessionScope: "a".repeat(43),
    recoveryScope: "content_unlock:00000000-0000-4000-8000-000000000010",
    intentId: "00000000-0000-4000-8000-000000000011",
    walletAddress: "1".repeat(32),
    quote: paymentQuote(),
    signature: "1".repeat(88),
    signedTransactionBase64: "b25l",
    idempotencyKey: "payment-command-1",
    intentExpiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-11-06T12:00:00.000Z",
    ...overrides
  };
}

function paymentQuote(): PendingPaymentSubmission["quote"] {
  return {
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
  };
}

class MemoryStorage implements PaymentRecoveryStorage {
  private readonly data = new Map<string, string>();

  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
