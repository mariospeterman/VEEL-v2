import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createPostgresMediaAssetCleanupRepository } from "../src/media-asset-cleanup.js";

describe("media asset cleanup source holds", () => {
  it("does not treat processing exports with elapsed holds as active", async () => {
    const mediaAssetId = "00000000-0000-4000-8000-000000000101";
    const queries: string[] = [];
    const execute = (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, content_item_id")) {
        return Promise.resolve([{
          id: mediaAssetId,
          content_item_id: "00000000-0000-4000-8000-000000000102",
          provider: "bunny",
          provider_asset_id: "provider-object",
          asset_kind: "image",
          provider_cleanup_attempt_count: 0
        }]);
      }
      if (query.includes("update media_assets")) return Promise.resolve([{ id: mediaAssetId }]);
      return Promise.resolve([]);
    };
    const transaction = vi.fn(execute) as unknown as postgres.TransactionSql;
    const sql = vi.fn(execute) as unknown as postgres.Sql;
    (sql as unknown as {
      begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
    }).begin = (work) => work(transaction);
    const repository = createPostgresMediaAssetCleanupRepository({ sql });

    await expect(repository.leaseDueCleanups({
      now: new Date("2026-11-07T00:00:00.000Z"),
      limit: 25,
      leaseDurationMs: 300_000
    })).resolves.toHaveLength(1);

    const holdPredicates = queries.filter((query) =>
      query.includes("from content_export_job_items export_item")
    );
    expect(holdPredicates).toHaveLength(2);
    for (const query of holdPredicates) {
      expect(query).toMatch(
        /export_job\.source_hold_until > \?\s+and export_job\.state in \('processing', 'queued', 'retry', 'dead_letter'\)/
      );
      expect(query).not.toMatch(/export_job\.state = 'processing'\s+or/);
    }
  });
});
