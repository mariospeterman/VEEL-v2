import { describe, expect, it, vi } from "vitest";
import { createPostgresPaymentEvidenceRepository } from "../src/modules/payment/payment-evidence-repository";
import type { PostgresSql } from "../src/shared/postgres";

describe("payment evidence repository", () => {
  it("prioritizes signature-bound intents and binds submitted or confirmed matches to the replayed signature", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const sql = vi.fn((stringsOrValues: TemplateStringsArray | unknown[], ...values: unknown[]) => {
      if (!Object.prototype.hasOwnProperty.call(stringsOrValues, "raw")) {
        return stringsOrValues;
      }

      const strings = stringsOrValues as TemplateStringsArray;
      queries.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    }) as unknown as PostgresSql;
    const repository = createPostgresPaymentEvidenceRepository(sql);

    await repository.findIntentByReference({
      referenceAddresses: ["old-confirmed-reference", "pending-reference"],
      includeConfirmed: true,
      submissionSignature: "replayed-signature"
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("pi.submitted_signature = ?");
    expect(queries[0]?.text).toContain("pi.state = 'submitted'");
    expect(queries[0]?.text).toContain("case when pi.state in ('submitted', 'confirmed') then 0 else 1 end asc");
    expect(queries[0]?.values).toEqual(expect.arrayContaining([true, "replayed-signature"]));
  });

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
