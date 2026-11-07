const auditClosureRepairBranch = "codex/audit-closure-repairs";

export const isScopedReviewRepairBranch = ({ activeBranch, latestMergedSlice }) => {
  if (activeBranch === auditClosureRepairBranch) {
    return true;
  }

  const latestMergedConvergence = /^Convergence (\d{2})(?:[A-Z])?\b/.exec(
    latestMergedSlice ?? "",
  )?.[1];
  if (!latestMergedConvergence) {
    return false;
  }

  return new RegExp(
    `^codex/converge-${latestMergedConvergence}-(?:[a-z0-9]+-)+repairs?$`,
  ).test(activeBranch ?? "");
};
