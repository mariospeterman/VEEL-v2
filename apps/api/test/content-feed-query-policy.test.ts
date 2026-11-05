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
    expect(repositorySource).toContain("page_ids as materialized");
    expect(repositorySource).toContain("order by content.published_at desc, content.id desc");
    expect(repositorySource).toContain("(content.published_at, content.id) <");
    expect(repositorySource).toContain("limit ${input.limit + 1}");
    expect(repositorySource).not.toMatch(/feed_ranking_sessions|candidate_window|ranking_score|base_score/i);
    expect(repositorySource).not.toMatch(/\blimit\s+512\b/i);
  });

  it("reauthorizes each page and keeps Following free of unrelated fallback", () => {
    expect(repositorySource).toContain("authorized_ids as materialized");
    expect(repositorySource).toContain("private.eligible_content(viewer.id, null)");
    expect(repositorySource).toContain("${input.mode} <> 'following'");
    expect(repositorySource).toContain("or current_follow.state = 'active'");
    expect(repositorySource).not.toContain("recommended");
  });

  it("keeps retired formats and monetary facts out of ordering", () => {
    expect(repositorySource).toContain("content.media_type not in ('text', 'poll')");
    expect(repositorySource).not.toMatch(
      /payment|settlement|wallet|purchase|revenue|earnings|amount_atomic|price/i
    );
  });
});
