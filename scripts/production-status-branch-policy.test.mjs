import { describe, expect, it } from "vitest";
import { isScopedReviewRepairBranch } from "./production-status-branch-policy.mjs";

describe("production status branch policy", () => {
  it("permits the named audit-closure repair without changing the planned slice", () => {
    expect(isScopedReviewRepairBranch({
      activeBranch: "codex/audit-closure-repairs",
      latestMergedSlice: "Convergence 09D — Landing final convergence",
    })).toBe(true);
  });

  it("retains the current-convergence scoped repair convention", () => {
    expect(isScopedReviewRepairBranch({
      activeBranch: "codex/converge-09-live-review-repairs",
      latestMergedSlice: "Convergence 09D — Landing final convergence",
    })).toBe(true);
  });

  it.each([
    "codex/audit-repairs",
    "codex/audit-closure-repair",
    "codex/converge-10-live-review-repairs",
    "codex/unplanned-feature",
  ])("does not broaden the exception to %s", (activeBranch) => {
    expect(isScopedReviewRepairBranch({
      activeBranch,
      latestMergedSlice: "Convergence 09D — Landing final convergence",
    })).toBe(false);
  });
});
