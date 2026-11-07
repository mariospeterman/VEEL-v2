import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createSubscriptionCancellationRepositoryMethods } from
  "../src/modules/subscription/subscription-cancellation-repository";
import { SubscriptionCollectionInFlightError } from
  "../src/modules/subscription/subscription-errors";

describe("subscription cancellation collection arbitration", () => {
  it("fences persisted signed evidence while exact reconciliation is pending", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("from subscription_action_receipts")) return Promise.resolve([]);
      if (query.includes("select s.id") && query.includes("from subscriptions s")) {
        return Promise.resolve([{ id: "00000000-0000-4000-8000-000000000103" }]);
      }
      if (query.includes("from subscription_collections collection")) {
        return Promise.resolve([{ id: "00000000-0000-4000-8000-000000000101" }]);
      }
      return Promise.resolve([]);
    }) as unknown as postgres.TransactionSql;
    (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      return Promise.resolve([{ id: "00000000-0000-4000-8000-000000000104" }]);
    }) as unknown as postgres.Sql;
    (sql as unknown as {
      begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
    }).begin = (work) => work(transaction);

    const repository = createSubscriptionCancellationRepositoryMethods(sql);
    await expect(repository.cancel({
      supabaseUserId: "supabase-user",
      subscriptionId: "00000000-0000-4000-8000-000000000103",
      idempotencyKey: "cancel-key",
      requestHash: "cancel-hash"
    })).rejects.toBeInstanceOf(SubscriptionCollectionInFlightError);

    const fence = queries.find((query) =>
      query.includes("from subscription_collections collection")
    );
    expect(queries.some((query) => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(fence).toContain("collection.state in ('due', 'processing', 'reconciling', 'failed', 'dead_letter')");
    expect(fence).toContain("collection.broadcast_signature is not null");
    expect(fence).toContain("for update of collection");
  });
});
