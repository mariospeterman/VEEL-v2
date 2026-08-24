import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { ContentPublishConflictError } from "../src/modules/content/content-errors";
import { createContentPublishRepositoryMethods } from "../src/modules/content/content-publish-repository";
import type { PostgresTransaction } from "../src/shared/postgres";

describe("content publish repository", () => {
  it("uses the canonical safety and provenance release predicate", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("for update")) return Promise.resolve([{ id: "content-id" }]);
      if (query.includes("with actor as")) return Promise.resolve([]);
      return Promise.resolve([{
        state: "ready",
        publish_state: "draft",
        moderation_state: "approved",
        provider_ready: true
      }]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as postgres.Sql;
    const repository = createContentPublishRepositoryMethods(sql);

    await expect(repository.publishOwnedContent!({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      contentId: "00000000-0000-4000-8000-000000000040",
      idempotencyKey: "test"
    })).rejects.toBeInstanceOf(ContentPublishConflictError);

    const publishQuery = queries.find((query) => query.includes("with actor as"));
    expect(queries.findIndex((query) => query.includes("for update"))).toBeLessThan(
      queries.findIndex((query) => query.includes("private.content_safety_release_ready"))
    );
    expect(queries.filter((query) => query.includes("for update"))).toHaveLength(1);
    expect(publishQuery).toContain("private.content_safety_release_ready(ci.id) as safety_ready");
    expect(publishQuery).not.toContain("for update");
    expect(publishQuery).not.toContain("private.content_composition_safety_ready(ci.id) as safety_ready");
  });
});
