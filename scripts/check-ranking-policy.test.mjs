import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  bulletBlockAfter,
  checkRankingPolicy,
  feedRankingImplementationChecks,
  financialSignalViolations,
} from "./check-ranking-policy.mjs";

describe("money-based ranking policy", () => {
  it("accepts the repository ranking implementation and active guidance", () => {
    assert.doesNotThrow(() => checkRankingPolicy());
  });

  it("rejects financial code or configuration signals", () => {
    assert.deepEqual(
      financialSignalViolations("score", ["like_count", "payment_amount", "subscriber_spend"]),
      ["score: payment_amount", "score: subscriber_spend"],
    );
  });

  it("inspects the bounded candidate and scoring SQL blocks", () => {
    const repository = [
      "candidate_window as materialized (",
      "select content.id from content_items content",
      "authorized as materialized (",
      "select eligible.content_item_id",
      "eligible as (",
      "select candidate.*, counter.like_count from candidate_window candidate",
      "scored as (",
      "select eligible.*, like_count * 2 as base_score from eligible",
      "snapshot as (",
      "select array_agg(id) from scored",
    ].join("\n");

    assert.deepEqual(feedRankingImplementationChecks(repository), [
      [
        "feed ranking candidate inputs",
        ["candidate_window as materialized (", "select content.id from content_items content", ""],
      ],
      [
        "feed ranking score inputs",
        [
          "eligible as (",
          "select candidate.*, counter.like_count from candidate_window candidate",
          "scored as (",
          "select eligible.*, like_count * 2 as base_score from eligible",
          "",
        ],
      ],
    ]);
  });

  it("rejects financial signals added to either feed ranking SQL block", () => {
    const repository = [
      "candidate_window as materialized (",
      "select content.id, wallet.balance from content_items content",
      "authorized as materialized (",
      "select eligible.content_item_id",
      "eligible as (",
      "select candidate.*, subscription.revenue from candidate_window candidate",
      "scored as (",
      "select eligible.*, revenue as base_score from eligible",
      "snapshot as (",
      "select array_agg(id) from scored",
    ].join("\n");
    const violations = feedRankingImplementationChecks(repository)
      .flatMap(([label, lines]) => financialSignalViolations(label, lines));

    assert.deepEqual(violations, [
      "feed ranking candidate inputs: select content.id, wallet.balance from content_items content",
      "feed ranking score inputs: select candidate.*, subscription.revenue from candidate_window candidate",
      "feed ranking score inputs: select eligible.*, revenue as base_score from eligible",
    ]);
  });

  it("fails closed when the bounded feed SQL markers drift", () => {
    assert.throws(
      () => feedRankingImplementationChecks("select 1"),
      /could not locate feed ranking candidate inputs/,
    );
  });

  it("checks only the declared allowed-signal bullet block", () => {
    const source = [
      "Allowed ranking signals:",
      "",
      "- follows",
      "- creator freshness",
      "",
      "Financial analytics may include revenue but are not ranking inputs.",
    ].join("\n");
    assert.deepEqual(bulletBlockAfter(source, "Allowed ranking signals:"), [
      "- follows",
      "- creator freshness",
    ]);
  });
});
