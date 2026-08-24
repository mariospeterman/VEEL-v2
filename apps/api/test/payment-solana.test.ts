import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { calculateSettlementSplit, PaymentAmountError } from "../src/modules/payment/payment-amounts";
import {
  buildCreatorSplitTransaction,
  SolanaPaymentConfigurationError,
  verifySolanaTransfer
} from "../src/modules/payment/solana-payment";
import {
  TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress
} from "../src/modules/solana/token-program";
import type { PaymentSettlementInput, StoredPaymentIntent } from "../src/modules/payment/types";

const signature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";
const buyerWallet = Keypair.generate().publicKey.toBase58();
const creatorWallet = Keypair.generate().publicKey.toBase58();
const enterpriseWallet = Keypair.generate().publicKey.toBase58();
const platformFeeWallet = Keypair.generate().publicKey.toBase58();
const treasuryWallet = Keypair.generate().publicKey.toBase58();
const referralWallet = Keypair.generate().publicKey.toBase58();
const referenceAddress = Keypair.generate().publicKey.toBase58();
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const blockTime = new Date("2026-01-01T00:00:00.000Z");

describe("payment amount calculation", () => {
  it("calculates an exact creator/platform split in atomic units", () => {
    expect(calculateSettlementSplit({ totalAmountAtomic: 10_000_000, platformFeeBps: 1_000 })).toEqual({
      totalAmountAtomic: 10_000_000,
      creatorSideProceedsAtomic: 9_000_000,
      creatorAmountAtomic: 9_000_000,
      enterpriseManagementAmountAtomic: 0,
      platformFeeGrossAtomic: 1_000_000,
      platformFeeAmountAtomic: 1_000_000,
      referralAmountAtomic: 0
    });
  });

  it("rounds platform fees deterministically down to atomic units", () => {
    expect(calculateSettlementSplit({ totalAmountAtomic: 101, platformFeeBps: 333 })).toEqual({
      totalAmountAtomic: 101,
      creatorSideProceedsAtomic: 98,
      creatorAmountAtomic: 98,
      enterpriseManagementAmountAtomic: 0,
      platformFeeGrossAtomic: 3,
      platformFeeAmountAtomic: 3,
      referralAmountAtomic: 0
    });
  });

  it("pays referral allocation from the platform fee without reducing creator share", () => {
    expect(calculateSettlementSplit({
      totalAmountAtomic: 10_000_000,
      platformFeeBps: 1_000,
      referralShareOfPlatformFeeBps: 2_000
    })).toEqual({
      totalAmountAtomic: 10_000_000,
      creatorSideProceedsAtomic: 9_000_000,
      creatorAmountAtomic: 9_000_000,
      enterpriseManagementAmountAtomic: 0,
      platformFeeGrossAtomic: 1_000_000,
      platformFeeAmountAtomic: 800_000,
      referralAmountAtomic: 200_000
    });
  });

  it("takes Enterprise management share from creator-side proceeds, independently of referral", () => {
    expect(calculateSettlementSplit({
      totalAmountAtomic: 10_000_000,
      platformFeeBps: 1_000,
      referralShareOfPlatformFeeBps: 2_000,
      enterpriseShareOfCreatorProceedsBps: 1_500
    })).toEqual({
      totalAmountAtomic: 10_000_000,
      creatorSideProceedsAtomic: 9_000_000,
      creatorAmountAtomic: 7_650_000,
      enterpriseManagementAmountAtomic: 1_350_000,
      platformFeeGrossAtomic: 1_000_000,
      platformFeeAmountAtomic: 800_000,
      referralAmountAtomic: 200_000
    });
  });

  it("rounds a sub-atomic Enterprise management share to zero without reducing creator proceeds", () => {
    expect(calculateSettlementSplit({
      totalAmountAtomic: 101,
      platformFeeBps: 333,
      enterpriseShareOfCreatorProceedsBps: 1
    })).toEqual({
      totalAmountAtomic: 101,
      creatorSideProceedsAtomic: 98,
      creatorAmountAtomic: 98,
      enterpriseManagementAmountAtomic: 0,
      platformFeeGrossAtomic: 3,
      platformFeeAmountAtomic: 3,
      referralAmountAtomic: 0
    });
  });

  it("rejects invalid totals, fees, and referral shares", () => {
    expect(() => calculateSettlementSplit({ totalAmountAtomic: 0, platformFeeBps: 1_000 })).toThrow(PaymentAmountError);
    expect(() => calculateSettlementSplit({ totalAmountAtomic: 100, platformFeeBps: 10_001 })).toThrow(PaymentAmountError);
    expect(() =>
      calculateSettlementSplit({ totalAmountAtomic: 100, platformFeeBps: 1_000, referralShareOfPlatformFeeBps: 10_001 })
    ).toThrow(PaymentAmountError);
  });

  it("keeps the maximum supported atomic total exact and rejects the first unsafe integer", () => {
    expect(calculateSettlementSplit({
      totalAmountAtomic: Number.MAX_SAFE_INTEGER,
      platformFeeBps: 1_000
    })).toEqual({
      totalAmountAtomic: 9_007_199_254_740_991,
      creatorSideProceedsAtomic: 8_106_479_329_266_892,
      creatorAmountAtomic: 8_106_479_329_266_892,
      enterpriseManagementAmountAtomic: 0,
      platformFeeGrossAtomic: 900_719_925_474_099,
      platformFeeAmountAtomic: 900_719_925_474_099,
      referralAmountAtomic: 0
    });

    expect(() => calculateSettlementSplit({
      totalAmountAtomic: Number.MAX_SAFE_INTEGER + 1,
      platformFeeBps: 1_000
    })).toThrow(PaymentAmountError);
  });
});

describe("Solana creator split settlement verification", () => {
  it("confirms an exact native SOL creator split", async () => {
    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ])).resolves.toEqual({ confirmed: true, blockTime });
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
      referralWallet,
      referralAmountMinor: 500_000,
      creatorAmountMinor: 9_000_000,
      platformFeeAmountMinor: 500_000
    });

    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 500_000),
      transfer(referralWallet, 500_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: true, blockTime });

    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 500_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: false, failureCode: "transfer_mismatch" });
  });

  it("requires the exact Enterprise transfer as a separate creator-proceeds allocation", async () => {
    const input = settlementInput({
      enterpriseWallet,
      creatorAmountMinor: 7_650_000,
      enterpriseManagementAmountMinor: 1_350_000
    });

    await expect(expectSettlement([
      transfer(creatorWallet, 7_650_000),
      transfer(enterpriseWallet, 1_350_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: true, blockTime });

    await expect(expectSettlement([
      transfer(creatorWallet, 7_650_000),
      transfer(platformFeeWallet, 1_000_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: false, failureCode: "transfer_mismatch" });
  });

  it("requires exact decoded memo content and rejects settlement after intent expiry", async () => {
    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      encodedMemo("wrong-memo")
    ])).resolves.toEqual({ confirmed: false, failureCode: "memo_missing" });

    await expect(expectSettlement([
      transfer(creatorWallet, 9_000_000),
      transfer(platformFeeWallet, 1_000_000),
      encodedMemo("veel:intent-1")
    ], {
      input: settlementInput({ expiresAt: new Date("2025-12-31T23:59:59.000Z") })
    })).resolves.toEqual({
      confirmed: false,
      failureCode: "intent_expired_before_settlement",
      blockTime
    });
  });

  it("confirms exact one-time USDC creator split transfers", async () => {
    const input = settlementInput({
      currency: "USDC",
      tokenMint: usdcMint,
      tokenDecimals: 6,
      totalAmountMinor: 1_000_000,
      creatorAmountMinor: 900_000,
      platformFeeAmountMinor: 100_000
    });

    await expect(expectSettlement([
      tokenTransfer(creatorWallet, 900_000),
      tokenTransfer(platformFeeWallet, 100_000),
      memo("veel:intent-1")
    ], { input })).resolves.toEqual({ confirmed: true, blockTime });
  });

  it("rejects unsafe or internally inconsistent expected amounts before querying Solana", async () => {
    const getParsedTransaction = vi.fn();
    const connection = { getParsedTransaction } as never;

    await expect(verifySolanaTransfer(connection, settlementInput({
      totalAmountMinor: Number.MAX_SAFE_INTEGER + 1
    }))).resolves.toEqual({
      confirmed: false,
      failureCode: "invalid_expected_amounts"
    });
    await expect(verifySolanaTransfer(connection, settlementInput({
      platformFeeAmountMinor: 999_999
    }))).resolves.toEqual({
      confirmed: false,
      failureCode: "invalid_expected_amounts"
    });
    expect(getParsedTransaction).not.toHaveBeenCalled();
  });
});

describe("Solana Pay transaction construction", () => {
  it("builds an unsigned one-time USDC split with token transfers and no native transfer", async () => {
    const encoded = await buildCreatorSplitTransaction({
      connection: {
        async getLatestBlockhash() {
          return {
            blockhash: Keypair.generate().publicKey.toBase58(),
            lastValidBlockHeight: 1
          };
        }
      },
      intent: storedUsdcIntent(),
      buyerWallet
    });
    const transaction = Transaction.from(Buffer.from(encoded, "base64"));
    const tokenInstructions = transaction.instructions.filter((instruction) =>
      instruction.programId.equals(TOKEN_PROGRAM_ID)
    );

    expect(transaction.feePayer?.toBase58()).toBe(buyerWallet);
    expect(tokenInstructions).toHaveLength(2);
    expect(transaction.instructions.some((instruction) =>
      instruction.programId.equals(SystemProgram.programId)
    )).toBe(false);
    expect(transaction.instructions.at(-1)?.data.toString("utf8")).toBe("veel:intent-1");
    expect(tokenInstructions.every((instruction) =>
      instruction.keys.some((key) => key.pubkey.toBase58() === referenceAddress)
    )).toBe(true);
  });

  it("refuses to compose transactions from unsafe or inconsistent stored amounts", async () => {
    const connection = {
      async getLatestBlockhash() {
        return {
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 1
        };
      }
    };
    const unsafeIntent = storedUsdcIntent();
    unsafeIntent.totalAmountMinor = Number.MAX_SAFE_INTEGER + 1;
    const inconsistentIntent = storedUsdcIntent();
    inconsistentIntent.platformFeeAmountMinor -= 1;

    await expect(buildCreatorSplitTransaction({
      connection,
      intent: unsafeIntent,
      buyerWallet
    })).rejects.toBeInstanceOf(SolanaPaymentConfigurationError);
    await expect(buildCreatorSplitTransaction({
      connection,
      intent: inconsistentIntent,
      buyerWallet
    })).rejects.toBeInstanceOf(SolanaPaymentConfigurationError);
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
  return verifySolanaTransfer(
    {
      async getParsedTransaction() {
        return {
          blockTime: Math.floor(blockTime.getTime() / 1_000),
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
    enterpriseWallet: null,
    platformFeeWallet,
    referralWallet: null,
    treasuryWallet,
    totalAmountMinor: 10_000_000,
    creatorAmountMinor: 9_000_000,
    enterpriseManagementAmountMinor: 0,
    platformFeeAmountMinor: 1_000_000,
    referralAmountMinor: 0,
    currency: "SOL",
    tokenMint: null,
    tokenDecimals: null,
    expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    ...overrides
  };
}

function storedUsdcIntent(): StoredPaymentIntent {
  return {
    id: "intent-1",
    productType: "support",
    targetId: "00000000-0000-4000-8000-000000000001",
    amountMinor: 1_000_000,
    currency: "USDC",
    state: "pending",
    settlementKind: "creator_split",
    buyerWallet: null,
    creatorWallet,
    enterpriseWallet: null,
    platformFeeWallet,
    referralWallet: null,
    treasuryWallet,
    totalAmountMinor: 1_000_000,
    creatorSideProceedsMinor: 900_000,
    creatorAmountMinor: 900_000,
    enterpriseManagementAmountMinor: 0,
    platformFeeGrossMinor: 100_000,
    platformFeeAmountMinor: 100_000,
    referralAmountMinor: 0,
    tokenMint: usdcMint,
    tokenDecimals: 6,
    referenceAddress,
    solanaCluster: "mainnet-beta",
    expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    quotedAt: new Date("2026-01-01T00:00:00.000Z"),
    minimumAmountMinor: 500_000,
    platformFeeBps: 1_000,
    referralShareOfPlatformFeeBps: 2_000,
    commercialPolicySource: "environment_default",
    commercialPolicyRevision: 0,
    requestHash: "request-hash",
    withdrawalWaiverRequired: false,
    withdrawalWaiverAcceptedAt: null,
    withdrawalWaiverVersion: null,
    termsVersion: null,
    durableConfirmationRequired: true,
    refundValueBasis: "original_crypto_amount",
    refundPolicy: {
      withdrawalWaiverRequired: false,
      withdrawalWaiverAcceptedAt: null,
      withdrawalWaiverVersion: "2026-01",
      termsVersion: "2026-01",
      durableConfirmationRequired: true,
      refundValueBasis: "original_crypto_amount"
    },
    quote: {
      minimumAmountMinor: 500_000,
      platformFeeBps: 1_000,
      referralShareOfPlatformFeeBps: 2_000,
      quotedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:15:00.000Z",
      policySource: "environment_default",
      policyRevision: 0
    }
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

function encodedMemo(value: string) {
  return {
    programId: {
      toBase58: () => "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
    },
    data: bs58.encode(Buffer.from(value, "utf8"))
  };
}

function tokenTransfer(destinationWallet: string, amount: number) {
  const mint = new PublicKey(usdcMint);
  return {
    program: "spl-token",
    parsed: {
      type: "transferChecked",
      info: {
        authority: buyerWallet,
        source: deriveAssociatedTokenAddress(mint, new PublicKey(buyerWallet)).toBase58(),
        destination: deriveAssociatedTokenAddress(
          mint,
          new PublicKey(destinationWallet)
        ).toBase58(),
        mint: usdcMint,
        tokenAmount: {
          amount: String(amount),
          decimals: 6
        }
      }
    }
  };
}
