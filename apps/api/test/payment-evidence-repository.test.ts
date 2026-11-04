import { describe, expect, it, vi } from "vitest";
import { createPostgresPaymentEvidenceRepository } from "../src/modules/payment/payment-evidence-repository";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";

describe("payment evidence repository", () => {
  it("stores the Solana receipt and replay event in one transaction", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      return Promise.resolve([{ id: query.includes("provider_webhook_receipts") ? "receipt-1" : "event-1" }]);
    }) as unknown as PostgresTransaction;
    transaction.json = vi.fn((value: unknown) => value) as PostgresTransaction["json"];
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createPostgresPaymentEvidenceRepository(sql);

    await expect(repository.recordSolanaProviderEvent({
      providerEventId: "solana-delivery-1",
      authorizationHash: "authorization-hash",
      eventType: "transaction",
      signature: "solana-signature",
      referenceAddresses: ["reference-address"]
    })).resolves.toBe(true);

    expect(sql.begin).toHaveBeenCalledOnce();
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("insert into provider_webhook_receipts");
    expect(queries[1]).toContain("insert into provider_events");
  });

  it("repairs a historical receipt-only orphan on authenticated redelivery", async () => {
    const transaction = vi.fn((strings: TemplateStringsArray) => Promise.resolve(
      strings.join("?").includes("provider_events") ? [{ id: "event-1" }] : []
    )) as unknown as PostgresTransaction;
    transaction.json = vi.fn((value: unknown) => value) as PostgresTransaction["json"];
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createPostgresPaymentEvidenceRepository(sql);

    await expect(repository.recordSolanaProviderEvent({
      providerEventId: "solana-orphan-redelivery",
      authorizationHash: "authorization-hash",
      eventType: "transaction",
      signature: "solana-signature",
      referenceAddresses: ["reference-address"]
    })).resolves.toBe(true);
  });

  it("returns duplicate only when both durable evidence rows already exist", async () => {
    const transaction = vi.fn(() => Promise.resolve([])) as unknown as PostgresTransaction;
    transaction.json = vi.fn((value: unknown) => value) as PostgresTransaction["json"];
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createPostgresPaymentEvidenceRepository(sql);

    await expect(repository.recordSolanaProviderEvent({
      providerEventId: "solana-duplicate",
      authorizationHash: "authorization-hash",
      eventType: "transaction",
      signature: "solana-signature",
      referenceAddresses: ["reference-address"]
    })).resolves.toBe(false);
  });

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
