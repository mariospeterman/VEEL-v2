import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositorySource = readFileSync(
  resolve(apiRoot, "src/modules/content/content-feed-repository.ts"),
  "utf8"
);

describe("content feed query policy", () => {
  it("uses an indexed chronological keyset without a ranking-session ceiling", () => {
    expect(repositorySource).toContain("MIN_FEED_CANDIDATE_BATCH = 128");
    expect(repositorySource).toContain("MAX_FEED_CANDIDATE_BATCH = 512");
    expect(repositorySource).toContain("isolation level repeatable read read only");
    expect(repositorySource).toContain("candidate_ids as materialized");
    expect(repositorySource).toContain("page_ids as materialized");
    expect(repositorySource).toContain("order by content.published_at desc, content.id desc");
    expect(repositorySource).toContain("(content.published_at, content.id) <");
    expect(repositorySource).toContain("limit ${candidateBatchSize}");
    expect(repositorySource).toContain('input.surface === "moments"');
    expect(repositorySource).toContain('input.surface === "bits"');
    expect(repositorySource).toContain('input.mode === "following"');
    expect(repositorySource).toContain("const followingFilter");
    expect(repositorySource).not.toMatch(/feed_ranking_sessions|candidate_window|ranking_score|base_score/i);
    expect(repositorySource).not.toContain("authorized_ids as materialized");
  });

  it("uses distinct first-page and cursor bounds that stay indexable in generic plans", () => {
    const candidateQuerySource = repositorySource.slice(
      repositorySource.indexOf("const candidateBounds"),
      repositorySource.indexOf("if (candidates.length === 0)")
    );

    expect(repositorySource).toContain("const candidateBounds = cursor === null");
    expect(repositorySource).toContain("${cursor.upper.publishedAt}::timestamptz");
    expect(repositorySource).toContain("${cursor.upper.id}::uuid");
    expect(repositorySource).toContain("${cursor.after.publishedAt}::timestamptz");
    expect(repositorySource).toContain("${cursor.after.id}::uuid");
    expect(candidateQuerySource).not.toContain("cursor?.upper");
    expect(candidateQuerySource).not.toContain("cursor?.after");
    expect(candidateQuerySource).not.toMatch(
      /::timestamptz\s+is null\s+or\s+\(content\.published_at, content\.id\)/i
    );
  });

  it("limits eligible page IDs before hydrating resource joins", () => {
    expect(repositorySource).toMatch(
      /page_ids as materialized \([\s\S]*?order by content\.published_at desc, content\.id desc\s+limit \$\{input\.limit \+ 1\}\s+\)\s+select/i
    );
  });

  it("reauthorizes each page and keeps Following free of unrelated fallback", () => {
    expect(repositorySource).toContain("private.eligible_content(");
    expect(repositorySource).toContain("candidate_ids.ids");
    expect(repositorySource).toContain("and (${followingFilter})");
    expect(repositorySource).toContain("current_follow.state = 'active'");
    expect(repositorySource).not.toContain("recommended");
  });

  it("keeps retired formats and monetary facts out of ordering", () => {
    expect(repositorySource).toContain("content.media_type not in ('text', 'poll')");
    expect(repositorySource).not.toMatch(
      /payment|settlement|wallet|purchase|revenue|earnings|amount_atomic|price/i
    );
  });
});
