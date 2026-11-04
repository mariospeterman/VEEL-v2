import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEED_RANKING_CANDIDATE_LIMIT } from "../src/modules/content/content-feed-repository.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositorySource = readFileSync(
  resolve(apiRoot, "src/modules/content/content-feed-repository.ts"),
  "utf8"
);

describe("content feed query policy", () => {
  it("materializes one bounded candidate window instead of hashing or sorting the corpus per page", () => {
    expect(FEED_RANKING_CANDIDATE_LIMIT).toBe(512);
    expect(repositorySource).toContain("candidate_window as materialized");
    expect(repositorySource).toContain("limit ${FEED_RANKING_CANDIDATE_LIMIT}");
    expect(repositorySource).toContain("insert into feed_ranking_sessions");
    expect(repositorySource).not.toMatch(/\bmd5\s*\(|\bstring_agg\s*\(/i);
    expect(repositorySource).not.toContain("rankingRevision");
  });

  it("reauthorizes snapshot items and reads current social projections at delivery", () => {
    expect(repositorySource).toContain("current_eligible as materialized");
    expect(repositorySource).toContain(
      "cross join lateral private.eligible_content(active_session.viewer_id, null) authorized"
    );
    expect(repositorySource).toContain(
      "join current_eligible eligible on eligible.content_item_id = content.id"
    );
    expect(repositorySource).toContain("or current_follow.state = 'active'");
    expect(repositorySource).toContain(
      "left join content_engagement_counters counter on counter.content_item_id = ci.id"
    );
    expect(repositorySource).toContain("coalesce(counter.like_count, 0) as like_count");
  });

  it("keeps monetary facts outside the ranking snapshot query", () => {
    const rankingQuery = repositorySource.slice(
      repositorySource.indexOf("async function createFeedRankingSession")
    );
    expect(rankingQuery).not.toMatch(
      /payment|settlement|wallet|purchase|revenue|earnings|amount_atomic|price/i
    );
  });
});
