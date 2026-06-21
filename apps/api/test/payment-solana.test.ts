import { describe, expect, it } from "vitest";
import { calculateCreatorSplit, PaymentAmountError } from "../src/modules/payment/payment-amounts";
import { verifyNativeSolTransfer } from "../src/modules/payment/solana-payment";
import type { PaymentSettlementInput } from "../src/modules/payment/types";

const signature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";
const buyerWallet = "1".repeat(32);
const creatorWallet = "2".repeat(32);
const platformFeeWallet = "3".repeat(32);
const treasuryWallet = "4".repeat(32);
const allocationWallet = "5".repeat(32);
const referenceAddress = "6".repeat(32);

describe("payment amount calculation", () => {
  it("calculates an exact creator/platform split in atomic units", () => {
    expect(calculateCreatorSplit({ totalAmountAtomic: 10_000_000, platformFeeBps: 1_000 })).toEqual({
      totalAmountAtomic: 10_000_000,
      creatorAmountAtomic: 9_000_000,
      platformFeeAmountAtomic: 1_000_000,
      allocationAmountAtomic: 0
    });
  });

  it("rounds platform fees deterministically down to atomic units", () => {
    expect(calculateCreatorSplit({ totalAmountAtomic: 101, platformFeeBps: 333 })).toEqual({
      totalAmountAtomic: 101,
      creatorAmountAtomic: 98,
      platformFeeAmountAtomic: 3,
      allocationAmountAtomic: 0
    });
  });

  it("rejects invalid totals, fees, and allocations", () => {
    expect(() => calculateCreatorSplit({ totalAmountAtomic: 0, platformFeeBps: 1_000 })).toThrow(PaymentAmountError);
    expect(() => calculateCreatorSplit({ totalAmountAtomic: 100, platformFeeBps: 10_001 })).toThrow(PaymentAmountError);
    expect(() =>
      calculateCreatorSplit({ totalAmountAtomic: 100, platformFeeBps: 9_000, allocationAmountAtomic: 20 })
    ).toThrow(PaymentAmountError);
  });
});

describe("Solana creator split settlement verification", () => {
  it("confirms an exact native SOL creator split", async () => {
    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ])).resolves.toEqual({ confirmed: true });
  });

  it("rejects wrong creator wallet or amount", async () => {
    await expect(expectSettlement([
      transfer("7".repeat(32), 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ])).resolves.toEqual({ confirmed: false, failureCode: "transfer_mismatch" });

    await expect(expectSettlement([
      transfer(creatorWallet, 8_999_999),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ])).resolves.toEqual({ confirmed: false, failureCode: "transfer_mismatch" });
  });

  it("rejects missing reference, memo, failed transaction, and full treasury payment", async () => {
    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ], { includeReference: false })).resolves.toEqual({ confirmed: false, failureCode: "reference_missing" });

    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000)
    ])).resolves.toEqual({ confirmed: false, failureCode: "memo_missing" });

    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ], { failed: true })).resolves.toEqual({ confirmed: false, failureCode: "transaction_failed" });

    await expect(expectSettlement([
      transfer(treasuryWallet, 10_000_000),
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ])).resolves.toEqual({ confirmed: false, failureCode: "creator_split_paid_treasury" });
  });

  it("requires exact optional allocation transfer when present", async () => {
    const input = settlementInput({
      allocationWallet,
      allocationAmountMinor: 500_000,
      creatorAmountMinor: 8_500_000
    });

    await expect(expectSettlement([
      transfer(creatorWallet, 8_500_000),
      transfer(platformFeeWallet, 1_000_000),
      transfer(allocationWallet, 500_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: true });

    await expect(expectSettlement([
      transfer(creatorWallet, 8_500_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: false, failureCode: "transfer_mismatch" });
  });
});

function expectSettlement(
  instructions: unknown[],
  options: {
    includeReference?: boolean;
    failed?: boolean;
    input?: PaymentSettlementInput;
  } = {}
) {
  const includeReference = options.includeReference ?? true;
  return verifyNativeSolTransfer(
    {
      async getParsedTransaction() {
        return {
          meta: options.failed ? { err: { InstructionError: [0, "Custom"] } } : { err: null },
          transaction: {
            message: {
              accountKeys: includeReference
                ? [{ pubkey: { toBase58: () => referenceAddress } }]
                : [{ pubkey: { toBase58: () => buyerWallet } }],
              instructions
            }
          }
        };
      }
    } as never,
    options.input ?? settlementInput()
  );
}

function settlementInput(overrides: Partial<PaymentSettlementInput> = {}): PaymentSettlementInput {
  return {
    signature,
    referenceAddress,
    memo: "veel:intent-1",
    settlementKind: "creator_split",
    buyerWallet,
    creatorWallet,
    platformFeeWallet,
    allocationWallet: null,
    treasuryWallet,
    totalAmountMinor: 10_000_000,
    creatorAmountMinor: 9_000_000,
    platformFeeAmountMinor: 1_000_000,
    allocationAmountMinor: 0,
    ...overrides
  };
}

function transfer(destination: string, lamports: number) {
  return {
    program: "system",
    parsed: {
      type: "transfer",
      info: {
        source: buyerWallet,
        destination,
        lamports
      }
    }
  };
}

function memo(value: string) {
  return {
    program: "spl-memo",
    parsed: value
  };
}
