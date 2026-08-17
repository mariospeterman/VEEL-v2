import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";
import {
  PaymentSubmissionWriteConflictError,
  recordPaymentSubmission
} from "../src/modules/payment/payment-submission";

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
});
