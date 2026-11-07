import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createPostgresNotificationDeliveryRepository } from "../src/notification-delivery";

describe("notification delivery lock order", () => {
  it("locks the device before the attempt for a revoked provider outcome", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("update notification_delivery_attempts")) {
        return Promise.resolve([{ id: "attempt" }]);
      }
      return Promise.resolve([{ id: "device" }]);
    }) as unknown as postgres.TransactionSql;
    const sql = vi.fn() as unknown as postgres.Sql;
    (sql as unknown as {
      begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
    }).begin = (work) => work(transaction);
    const repository = createPostgresNotificationDeliveryRepository({ sql });

    await repository.recordDeliveryOutcome({
      attemptId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000002",
      deviceSubscriptionGeneration: 4,
      userId: "00000000-0000-4000-8000-000000000003",
      leaseToken: "00000000-0000-4000-8000-000000000004",
      maxAttempts: 8,
      outcome: { state: "revoked", failureCode: "push_subscription_gone" }
    });

    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("from notification_devices");
    expect(queries[0]).toContain("for update");
    expect(queries[1]).toContain("update notification_delivery_attempts");
    expect(queries[2]).toContain("update notification_devices");
    expect(queries[2]).toContain("subscription_generation = ?");
    expect(queries[2]).toContain("user_id = ?");
  });
});
