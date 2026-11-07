import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";
import {
  PaymentSubmissionWriteConflictError,
  recordPaymentSubmission
} from "../src/modules/payment/payment-submission";
import type {
  PaymentSettlementFailureCode,
  PaymentSettlementIntentState
} from "../src/modules/payment/types";

describe("payment submission write boundary", () => {
  it("rejects a replay write when the matched state or signature changed", async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
      queries.push(strings.join("?"));
      values.push(...queryValues);
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;

    await expect(recordPaymentSubmission(sql, {
      supabaseUserId: "supabase-user-1",
      paymentIntentId: "payment-intent-1",
      signature: "signature-a",
      settlement: { confirmed: true },
      writeGuard: {
        state: "submitted",
        submittedSignature: "signature-a"
      }
    })).rejects.toBeInstanceOf(PaymentSubmissionWriteConflictError);

    expect(queries[0]).toContain("pi.state = ?");
    expect(queries[0]).toContain("pi.submitted_signature is not distinct from ?");
    expect(values).toContain("submitted");
    expect(values).toContain("signature-a");
    expect(queries).toHaveLength(1);
  });

  it.each([
    "not_found",
    "block_time_missing",
    "transient"
  ] satisfies PaymentSettlementFailureCode[])(
    "keeps %s settlement evidence submitted and recoverable",
    async (failureCode) => {
      const captured = await captureSettlementWrite(failureCode);

      expect(captured.intentState).toBe("submitted");
      expect(captured.terminalFailure).toBe(false);
      expect(captured.intentFailureReason).toBeNull();
      expect(captured.walletState).toBe("submitted");
      expect(captured.attemptState).toBe("submitted");
      expect(captured.attemptFailureCode).toBe(failureCode);
    }
  );

  it.each([
    ["transaction_failed", "failed"],
    ["reference_missing", "failed"],
    ["memo_missing", "failed"],
    ["creator_split_paid_treasury", "failed"],
    ["transfer_mismatch", "failed"],
    ["invalid_expected_amounts", "failed"],
    ["invalid_signature", "failed"],
    ["intent_expired_before_settlement", "expired"],
    ["signed_transaction_expired", "expired"]
  ] satisfies Array<[PaymentSettlementFailureCode, PaymentSettlementIntentState]>)(
    "atomically terminalizes %s settlement evidence as %s",
    async (failureCode, expectedState) => {
      const captured = await captureSettlementWrite(failureCode);

      expect(captured.intentState).toBe(expectedState);
      expect(captured.terminalFailure).toBe(true);
      expect(captured.intentFailureReason).toBe(failureCode);
      expect(captured.walletState).toBe("failed");
      expect(captured.attemptState).toBe(expectedState);
      expect(captured.attemptFailureCode).toBe(failureCode);
    }
  );

  it("lets one concurrent same-signature reconciliation win and rejects the stale writer", async () => {
    let updateCalls = 0;
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("update payment_intents pi")) {
        updateCalls += 1;
        return Promise.resolve(updateCalls === 1 ? [updatedIntentRow()] : []);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const input = {
      supabaseUserId: "supabase-user-1",
      paymentIntentId: "payment-intent-1",
      signature: "same-signature",
      settlement: { confirmed: false as const, failureCode: "not_found" as const },
      writeGuard: {
        state: "submitted" as const,
        submittedSignature: "same-signature"
      }
    };

    const results = await Promise.allSettled([
      recordPaymentSubmission(sql, input),
      recordPaymentSubmission(sql, input)
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(PaymentSubmissionWriteConflictError)
    });
    expect(updateCalls).toBe(2);
  });

  it("fences an expiry writer against a concurrent confirmation for the same signature", async () => {
    let updateCalls = 0;
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("update payment_intents pi")) {
        updateCalls += 1;
        return Promise.resolve(updateCalls === 1 ? [updatedIntentRow()] : []);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const common = {
      supabaseUserId: "supabase-user-1",
      paymentIntentId: "payment-intent-1",
      signature: "same-signature",
      writeGuard: {
        state: "submitted" as const,
        submittedSignature: "same-signature"
      }
    };

    const results = await Promise.allSettled([
      recordPaymentSubmission(sql, {
        ...common,
        settlement: {
          confirmed: false,
          failureCode: "signed_transaction_expired"
        }
      }),
      recordPaymentSubmission(sql, { ...common, settlement: { confirmed: true } })
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: expect.any(PaymentSubmissionWriteConflictError)
    });
    expect(updateCalls).toBe(2);
  });
});

async function captureSettlementWrite(failureCode: PaymentSettlementFailureCode) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });
    if (text.includes("update payment_intents pi")) {
      return Promise.resolve([updatedIntentRow()]);
    }
    return Promise.resolve([]);
  }) as unknown as PostgresTransaction;
  const sql = {
    begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
  } as unknown as PostgresSql;

  await recordPaymentSubmission(sql, {
    supabaseUserId: "supabase-user-1",
    paymentIntentId: "payment-intent-1",
    signature: "signature-a",
    settlement: { confirmed: false, failureCode }
  });

  const intentWrite = queries.find((query) => query.text.includes("update payment_intents pi"));
  const walletWrite = queries.find((query) => query.text.includes("insert into wallet_transaction_records"));
  const attemptWrite = queries.find((query) => query.text.includes("insert into payment_settlement_attempts"));
  expect(intentWrite).toBeDefined();
  expect(walletWrite).toBeDefined();
  expect(attemptWrite).toBeDefined();

  return {
    intentState: intentWrite?.values[0],
    terminalFailure: intentWrite?.values[5],
    intentFailureReason: intentWrite?.values[6],
    walletState: walletWrite?.values[3],
    attemptState: attemptWrite?.values[3],
    attemptFailureCode: attemptWrite?.values[4]
  };
}

function updatedIntentRow() {
  return {
    payment_intent_id: "payment-intent-1",
    user_id: "user-1",
    product_type: "support",
    target_id: "creator-1",
    amount_minor: 100,
    creator_amount_minor: 90,
    platform_fee_amount_minor: 10,
    referral_amount_minor: 0,
    currency: "USDC"
  };
}
