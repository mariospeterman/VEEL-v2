import { describe, expect, it, vi } from "vitest";
import { createPostgresContentExportRepository } from
  "../src/modules/content-export/content-export-repository.js";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres.js";

describe("content export repository authorization", () => {
  it("authorizes a canonical users.id once without consulting the compatibility identity column", async () => {
    const queries: string[] = [];
    let accessed = false;
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select job.archive_object_key")) {
        return Promise.resolve(accessed ? [] : [{
          archive_object_key: "exports/owner/job.tar",
          archive_byte_size: 512,
          archive_sha256: "a".repeat(64),
          requester_user_id: uuidFor(1)
        }]);
      }
      if (query.includes("update content_export_download_grants")) accessed = true;
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    transaction.json = ((value: unknown) => value) as PostgresTransaction["json"];
    const sql = {
      begin: vi.fn(async <T>(work: (tx: PostgresTransaction) => Promise<T>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createPostgresContentExportRepository(sql);
    const input = {
      userId: uuidFor(1),
      jobId: uuidFor(2),
      grantId: uuidFor(3),
      now: new Date("2026-11-06T00:00:00.000Z")
    };

    await expect(repository.authorizeDownload(input)).resolves.toMatchObject({
      archiveObjectKey: "exports/owner/job.tar",
      archiveByteSize: 512
    });
    await expect(repository.authorizeDownload(input)).resolves.toBeNull();

    const authorizationQuery = queries.find((query) => query.includes("select job.archive_object_key"));
    expect(authorizationQuery).toContain("where actor.id =");
    expect(authorizationQuery).toContain("grant.last_accessed_at is null");
    expect(authorizationQuery).toContain("current_content.state::text in ('blocked', 'deleted')");
    expect(authorizationQuery).not.toContain("supabase_user_id");
    const consumeQuery = queries.find((query) => query.includes("update content_export_download_grants"));
    expect(consumeQuery).toContain("last_accessed_at is null");
  });
});

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
