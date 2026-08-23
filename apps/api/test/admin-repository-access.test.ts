import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createAccessRepository } from "../src/modules/admin/admin-repository-access";

describe("admin queue recovery", () => {
  it("clears the live-safety queue's actual lease expiry column", async () => {
    const queries: string[] = [];
    const sql = ((first: TemplateStringsArray | string, ...values: unknown[]) => {
      if (typeof first === "string") return { fragment: first };
      const query = first.reduce((text, part, index) => {
        const value = values[index] as { fragment?: string } | undefined;
        return text + part + (value?.fragment ?? "?");
      }, "");
      queries.push(query);
      return Promise.resolve([{ accepted: true }]);
    }) as unknown as postgres.Sql;

    const accepted = await createAccessRepository(sql).retryDeadLetterJob({
      supabaseUserId: "supabase-admin",
      queueName: "live_safety",
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "retry-live-safety-1",
      body: { reason: "Provider recovered" }
    });

    expect(accepted).toBe(true);
    const recoveryQuery = queries.find((query) => query.includes("worker_queue_recovery_requests"));
    expect(recoveryQuery).toContain("lease_expires_at = null");
    expect(recoveryQuery).not.toContain("leased_until = null");
  });
});
