import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { PostgresTransaction } from "../src/shared/postgres";
import { createContentUpdateRepositoryMethods } from "../src/modules/content/content-update-repository";

describe("content update repository", () => {
  it("withdraws published content when its safety declaration changes", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("with actor as")) {
        return Promise.resolve([{
          id: "00000000-0000-4000-8000-000000000040",
          media_type: "vod",
          caption: "Published media",
          nsfw_label: "adult",
          creator_id: "00000000-0000-4000-8000-000000000001",
          handle: "creator",
          display_name: "Creator",
          avatar_url: null
        }]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) =>
        work(transaction))
    } as unknown as postgres.Sql;
    const repository = createContentUpdateRepositoryMethods(sql);

    await repository.updateOwnedContent?.({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      contentId: "00000000-0000-4000-8000-000000000040",
      idempotencyKey: "published-safety-edit-1",
      captionProvided: false,
      nsfwLabel: "adult",
      representationMode: "self_only",
      contentSafetyPolicyAccepted: true,
      teaserStartMsProvided: false,
      teaserEndMsProvided: false,
      thumbnailFrameMsProvided: false,
      eventDraftProvided: false
    });

    const updateQuery = queries.find((query) => query.includes("update content_items ci"));
    expect(updateQuery).toContain("publish_state = case");
    expect(updateQuery).toContain("then 'submitted_for_review'");
    expect(updateQuery).toContain("moderation_state = case");
    expect(updateQuery).toContain("then 'pending'");
    expect(updateQuery).toContain("published_at = case");
  });
});
