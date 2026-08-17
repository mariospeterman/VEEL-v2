import { describe, expect, it, vi } from "vitest";
import { createPostgresPaymentEvidenceRepository } from "../src/modules/payment/payment-evidence-repository";
import type { PostgresSql } from "../src/shared/postgres";

describe("payment evidence repository", () => {
  it("updates Solana event and receipt evidence under the originating provider alias", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    }) as unknown as PostgresSql;
    const repository = createPostgresPaymentEvidenceRepository(sql);

    await repository.updateSolanaProviderEvent({
      provider: "solana_indexer",
      providerEventId: "solana-delivery-1",
      normalizedState: "processed"
    });

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.values.includes("solana_indexer"))).toBe(true);
    expect(queries.every((query) => query.values.includes("solana-delivery-1"))).toBe(true);
  });
});
