import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";
import { withPostgresTransaction } from "../src/shared/postgres";

describe("Postgres transaction helper", () => {
  it("runs work inside a single Postgres transaction", async () => {
    const transaction = vi.fn() as unknown as PostgresTransaction;
    const begin = vi.fn(async (work: (tx: PostgresTransaction) => Promise<string>) => work(transaction));
    const sql = { begin } as unknown as PostgresSql;

    const result = await withPostgresTransaction(sql, async (tx) => {
      expect(tx).toBe(transaction);
      return "committed";
    });

    expect(result).toBe("committed");
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("lets Postgres rollback semantics propagate transaction errors", async () => {
    const error = new Error("settlement failed");
    const transaction = vi.fn() as unknown as PostgresTransaction;
    const begin = vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction));
    const sql = { begin } as unknown as PostgresSql;

    await expect(
      withPostgresTransaction(sql, async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(begin).toHaveBeenCalledTimes(1);
  });
});
