import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  bulletBlockAfter,
  checkRankingPolicy,
  feedChronologyViolations,
  feedRankingImplementationChecks,
  financialSignalViolations
} from "./check-ranking-policy.mjs";

describe("chronological feed policy", () => {
  it("accepts the repository and canonical guidance", () => {
    assert.doesNotThrow(() => checkRankingPolicy());
  });

  it("rejects financial ordering inputs", () => {
    assert.deepEqual(
      financialSignalViolations("order", ["published_at", "payment_amount", "subscriber_spend"]),
      ["order: payment_amount", "order: subscriber_spend"]
    );
  });

  it("inspects the bounded page-selection SQL block", () => {
    const repository = [
      "page_ids as materialized (",
      "select content.id from content_items content",
      "order by content.published_at desc, content.id desc",
      "select",
      "          ci.id,"
    ].join("\n");

    assert.deepEqual(feedRankingImplementationChecks(repository), [[
      "chronological feed page selection",
      [
        "page_ids as materialized (",
        "select content.id from content_items content",
        "order by content.published_at desc, content.id desc",
        ""
      ]
    ]]);
  });

  it("rejects retired scoring sessions and missing policy boundaries", () => {
    const violations = feedChronologyViolations("feed_ranking_sessions ranking_score");
    assert.ok(violations.includes("feed must order by published_at DESC and id DESC"));
    assert.ok(violations.includes("retired scoring/session inputs remain in the active feed repository"));
  });

  it("fails closed when the feed SQL markers drift", () => {
    assert.throws(
      () => feedRankingImplementationChecks("select 1"),
      /could not locate chronological feed page selection/
    );
  });

  it("checks only the declared chronological guidance block", () => {
    const source = [
      "Chronological ordering inputs:",
      "",
      "- immutable first-publication time",
      "- stable content ID tie-breaker",
      "",
      "Financial analytics may include revenue outside feed ordering."
    ].join("\n");
    assert.deepEqual(bulletBlockAfter(source, "Chronological ordering inputs:"), [
      "- immutable first-publication time",
      "- stable content ID tie-breaker"
    ]);
  });
});
