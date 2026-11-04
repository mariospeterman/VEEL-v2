import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres.js";
import { recordPaymentSubmission } from "../src/modules/payment/payment-submission.js";
import { MutationCommandIdempotencyConflictError } from "../src/shared/mutation-command-receipt.js";

describe("payment submission command receipts", () => {
  it("serializes concurrent confirmation, replays a lost response, and rejects changed input", async () => {
    const actorId = uuidFor(1);
    const paymentIntentId = uuidFor(2);
    let receipt: {
      target_type: string;
      target_id: string;
      request_version: number;
      request_body_hash: string;
      response_status: number;
      response_body: unknown;
    } | null = null;
    let settlementAttempts = 0;

    const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("update payment_intents pi")) {
        return Promise.resolve([{
          payment_intent_id: paymentIntentId,
          user_id: actorId,
          product_type: "support",
          target_id: uuidFor(3),
          amount_minor: 100,
          creator_amount_minor: 90,
          platform_fee_amount_minor: 10,
          referral_amount_minor: 0,
          currency: "USDC"
        }]);
      }
      if (query.includes("from users") && query.includes("supabase_user_id")) {
        return Promise.resolve([{ id: actorId }]);
      }
      if (query.includes("from mutation_command_receipts")) {
        return Promise.resolve(receipt ? [receipt] : []);
      }
      if (query.includes("insert into mutation_command_receipts")) {
        receipt = {
          target_type: String(values[2]),
          target_id: String(values[3]),
          request_version: Number(values[5]),
          request_body_hash: String(values[6]),
          response_status: Number(values[7]),
          response_body: typeof values[8] === "string" ? JSON.parse(values[8]) : values[8]
        };
        return Promise.resolve([]);
      }
      if (query.includes("insert into payment_settlement_attempts")) {
        settlementAttempts += 1;
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    (transaction as unknown as { json: (value: unknown) => unknown }).json = (value) => value;

    let queue = Promise.resolve();
    const sql = {
      begin: vi.fn(<T>(work: (tx: PostgresTransaction) => Promise<T>) => {
        const result = queue.then(() => work(transaction));
        queue = result.then(() => undefined, () => undefined);
        return result;
      })
    } as unknown as PostgresSql;
    const input = {
      supabaseUserId: uuidFor(10),
      paymentIntentId,
      idempotencyKey: "payment-submit-1",
      signature: "confirmed-signature-a",
      settlement: { confirmed: true as const }
    };

    await Promise.all([
      recordPaymentSubmission(sql, input),
      recordPaymentSubmission(sql, input)
    ]);
    await expect(recordPaymentSubmission(sql, input)).resolves.toBeUndefined();
    expect(settlementAttempts).toBe(1);
    expect(receipt).toMatchObject({
      target_type: "payment_intent",
      target_id: paymentIntentId,
      response_status: 202,
      response_body: { accepted: true }
    });

    await expect(recordPaymentSubmission(sql, {
      ...input,
      signature: "changed-signature"
    })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
    expect(settlementAttempts).toBe(1);
  });
});

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
