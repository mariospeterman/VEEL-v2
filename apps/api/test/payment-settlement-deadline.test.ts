import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPaymentSettlementWithinDeadline } from "../src/modules/payment/payment-settlement-deadline";
import type {
  PaymentSettlementInput,
  PaymentSettlementVerifier
} from "../src/modules/payment/types";

describe("immediate payment settlement verification deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns control and aborts the provider when immediate verification never settles", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    const verifier: PaymentSettlementVerifier = {
      verifyTransfer(_input, options) {
        providerSignal = options?.signal;
        return new Promise(() => undefined);
      }
    };
    const verification = verifyPaymentSettlementWithinDeadline(
      verifier,
      settlementInput(),
      { timeoutMs: 25 }
    );
    const rejection = expect(verification).rejects.toThrow("deadline exceeded");

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(providerSignal?.aborted).toBe(true);
  });

  it("does not invoke the provider when the parent request was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Request closed"));
    const verifier: PaymentSettlementVerifier = {
      verifyTransfer: vi.fn()
    };

    await expect(verifyPaymentSettlementWithinDeadline(
      verifier,
      settlementInput(),
      { signal: controller.signal }
    )).rejects.toThrow("Request closed");
    expect(verifier.verifyTransfer).not.toHaveBeenCalled();
  });
});

function settlementInput(): PaymentSettlementInput {
  return {
    signature: "1".repeat(88),
    referenceAddress: "2".repeat(32),
    memo: "veel:payment-intent",
    settlementKind: "creator_split",
    buyerWallet: "3".repeat(32),
    creatorWallet: "4".repeat(32),
    enterpriseWallet: null,
    platformFeeWallet: "5".repeat(32),
    referralWallet: null,
    treasuryWallet: "6".repeat(32),
    totalAmountMinor: 10,
    creatorAmountMinor: 9,
    enterpriseManagementAmountMinor: 0,
    platformFeeAmountMinor: 1,
    referralAmountMinor: 0,
    currency: "SOL",
    tokenMint: null,
    tokenDecimals: null,
    expiresAt: new Date("2027-01-01T00:00:00.000Z")
  };
}
