import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertCleanCaptureWorkspace,
  assertNoProhibitedStagedPaths,
  atomicWriteFileSafe,
  buildIndexSnapshot,
  changedSymlinkCanonicalTarget,
  commandUsesShellWrapper,
  finalEvidenceStateErrors,
  getSupplementalFindings,
  observeWorkspace,
  receiptReference,
  registerSupplementalDisposition,
  reviewClassification,
  resolveSupplementalRecords,
  secretBearingArgvErrors,
  validateExecutionReceipt,
  validateChangedSymlinkEvidence,
  validateOriginalEvidenceIndex,
  validateSemanticReviewRecord
} from "./generate-audit-evidence.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const evidenceRoot = "docs/v2-new-build/audit-evidence/71ceabc";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function write(root, path, value) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value);
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "wevid-audit-evidence-test-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "audit-test@example.invalid"]);
  git(root, ["config", "user.name", "Audit Test"]);
  write(root, "src/app.ts", "export const value = 1;\n");
  write(root, "docs/v2-new-build/current-implementation-status.md", "protected baseline\n");
  write(root, `${evidenceRoot}/issue-ledger.json`, "{}\n");
  write(root, `${evidenceRoot}/file-coverage.json`, "{}\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "initial"]);
  return root;
}

test("source fingerprint excludes generated outputs, receipts, dirty protected bytes, and untracked files", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = buildIndexSnapshot(root);

  write(root, `${evidenceRoot}/issue-ledger.json`, "changed ledger\n");
  write(root, `${evidenceRoot}/file-coverage.json`, "changed manifest\n");
  write(root, "docs/v2-new-build/current-implementation-status.md", "protected dirty\n");
  write(root, "untracked.txt", "not committed evidence\n");
  assert.equal(buildIndexSnapshot(root).sourceFingerprintSha256, initial.sourceFingerprintSha256);

  const observation = observeWorkspace(root);
  assert.deepEqual(observation.protectedDirty, ["docs/v2-new-build/current-implementation-status.md"]);
  assert.deepEqual(observation.untracked, ["untracked.txt"]);
  assert.deepEqual(observation.otherDirty.sort(), [
    `${evidenceRoot}/file-coverage.json`,
    `${evidenceRoot}/issue-ledger.json`
  ]);

  write(root, `${evidenceRoot}/execution-receipts/test-receipt.redacted.txt`, "redacted log\n");
  write(root, `${evidenceRoot}/semantic-reviews/review-one.json`, "{}\n");
  git(root, ["add", `${evidenceRoot}/issue-ledger.json`, `${evidenceRoot}/file-coverage.json`, `${evidenceRoot}/execution-receipts/test-receipt.redacted.txt`, `${evidenceRoot}/semantic-reviews/review-one.json`]);
  assert.equal(buildIndexSnapshot(root).sourceFingerprintSha256, initial.sourceFingerprintSha256);

  write(root, "src/app.ts", "export const value = 2;\n");
  git(root, ["add", "src/app.ts"]);
  assert.notEqual(buildIndexSnapshot(root).sourceFingerprintSha256, initial.sourceFingerprintSha256);
});

test("index snapshot is deterministic in a fresh checkout and independent of remote metadata", (t) => {
  const root = createRepository();
  const cloneParent = mkdtempSync(join(tmpdir(), "wevid-audit-evidence-clone-"));
  const clone = join(cloneParent, "checkout");
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(cloneParent, { recursive: true, force: true });
  });
  const expected = buildIndexSnapshot(root);
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", root, clone]);
  git(clone, ["remote", "set-url", "origin", "https://example.invalid/different.git"]);
  const actual = buildIndexSnapshot(clone);
  assert.equal(actual.sourceFingerprintSha256, expected.sourceFingerprintSha256);
  assert.deepEqual(actual.fingerprintRows, expected.fingerprintRows);
});

test("supplemental findings have separate stable IDs and canonical baseline links", () => {
  const findings = getSupplementalFindings();
  assert.ok(findings.length > 0);
  assert.equal(new Set(findings.map((finding) => finding.id)).size, findings.length);
  for (const finding of findings) {
    assert.match(finding.id, /^PR134-\d{3}$/);
    assert.equal(finding.recordType, "pr134_supplemental_finding");
    assert.equal(finding.finalDisposition, undefined);
    assert.ok(finding.relatedBaselineIds.length > 0);
  }
  assert.deepEqual(findings.find((finding) => finding.id === "PR134-006").relatedBaselineIds, ["PAY-09"]);
});

test("execution receipts require exact source, redacted log, evidence, and nonzero test collection", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const beforeReceipt = buildIndexSnapshot(root);
  const logPath = `${evidenceRoot}/execution-receipts/vitest-worker.redacted.txt`;
  const receiptPath = `${evidenceRoot}/execution-receipts/vitest-worker.json`;
  const logBytes = Buffer.from("redacted vitest output\n");
  write(root, logPath, logBytes);
  const sourceEntry = beforeReceipt.entriesByPath.get("src/app.ts");
  const receipt = {
    schemaVersion: 1,
    id: "vitest-worker",
    sourceFingerprintSha256: beforeReceipt.sourceFingerprintSha256,
    command: { argv: ["pnpm", "exec", "vitest", "run", "apps/worker/test/index.test.ts"], cwd: "." },
    runtime: { nodeVersion: "v22.23.4", pnpmVersion: "10.0.0", gitVersion: "git version 2.50.0" },
    result: {
      kind: "vitest",
      status: "passed",
      exitCode: 0,
      signal: null,
      tests: { total: 3, passed: 3, failed: 0, skipped: 0, todo: 0 }
    },
    log: { path: logPath, sha256: sha256(logBytes), bytes: logBytes.length, redacted: true },
    evidence: [{ path: "src/app.ts", sha256: sourceEntry.sha256 }]
  };
  write(root, receiptPath, `${JSON.stringify(receipt)}\n`);
  git(root, ["add", logPath, receiptPath]);
  const withReceipt = buildIndexSnapshot(root);
  const reference = receiptReference("vitest-worker", {
    argv: receipt.command.argv,
    cwd: ".",
    resultKind: "vitest",
    evidencePaths: ["src/app.ts"]
  });
  assert.equal(withReceipt.sourceFingerprintSha256, beforeReceipt.sourceFingerprintSha256);
  assert.deepEqual(
    validateExecutionReceipt(receipt, withReceipt, reference),
    { valid: true, errors: [] }
  );

  const zeroTests = structuredClone(receipt);
  zeroTests.result.tests = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 };
  assert.ok(validateExecutionReceipt(zeroTests, withReceipt).errors.includes("zero_or_unknown_test_count"));

  const allSkipped = structuredClone(receipt);
  allSkipped.result.tests = { total: 3, passed: 0, failed: 0, skipped: 3, todo: 0 };
  assert.ok(validateExecutionReceipt(allSkipped, withReceipt).errors.includes("passed_without_executed_tests"));

  const negativeCount = structuredClone(receipt);
  negativeCount.result.tests = { total: 1, passed: 3, failed: -2, skipped: 0, todo: 0 };
  assert.ok(validateExecutionReceipt(negativeCount, withReceipt).errors.includes("invalid_test_counts"));

  const missingVersions = structuredClone(receipt);
  missingVersions.runtime.pnpmVersion = null;
  missingVersions.runtime.gitVersion = null;
  assert.ok(validateExecutionReceipt(missingVersions, withReceipt).errors.includes("missing_pnpm_version"));
  assert.ok(validateExecutionReceipt(missingVersions, withReceipt).errors.includes("missing_git_version"));

  const wrongSource = structuredClone(receipt);
  wrongSource.sourceFingerprintSha256 = "0".repeat(64);
  assert.ok(validateExecutionReceipt(wrongSource, withReceipt).errors.includes("source_fingerprint_mismatch"));

  const wrongLog = structuredClone(receipt);
  wrongLog.log.sha256 = "f".repeat(64);
  assert.ok(validateExecutionReceipt(wrongLog, withReceipt).errors.includes("log_fingerprint_mismatch"));

  const ignoredLogSuffix = structuredClone(receipt);
  ignoredLogSuffix.log.path = `${evidenceRoot}/execution-receipts/vitest-worker.log`;
  assert.ok(validateExecutionReceipt(ignoredLogSuffix, withReceipt).errors.includes("invalid_redacted_log_metadata"));

  const disguisedTest = structuredClone(receipt);
  disguisedTest.result.kind = "generic";
  disguisedTest.result.tests = null;
  assert.ok(validateExecutionReceipt(disguisedTest, withReceipt).errors.includes("test_command_requires_structured_result_kind"));

  assert.ok(validateExecutionReceipt(receipt, withReceipt, receiptReference("vitest-worker", {
    argv: receipt.command.argv,
    cwd: ".",
    resultKind: "vitest",
    evidencePaths: ["src/does-not-exist.ts"]
  })).errors.includes("expected_evidence_path_missing:src/does-not-exist.ts"));

  const wrongBinding = receiptReference("vitest-worker", {
    argv: ["pnpm", "exec", "vitest", "run", "different.test.ts"],
    cwd: ".",
    resultKind: "node_test",
    evidencePaths: ["src/app.ts"]
  });
  const wrongBindingErrors = validateExecutionReceipt(receipt, withReceipt, wrongBinding).errors;
  assert.ok(wrongBindingErrors.includes("command_argv_mismatch"));
  assert.ok(wrongBindingErrors.includes("result_kind_mismatch"));

  const unknownKind = structuredClone(receipt);
  unknownKind.result.kind = "custom_success";
  assert.ok(validateExecutionReceipt(unknownKind, withReceipt).errors.includes("unknown_result_kind"));

  const genericReference = {
    kind: "execution_receipt_reference",
    receiptId: "vitest-worker",
    expectedCommand: { argv: receipt.command.argv, cwd: "." },
    expectedResultKind: "generic",
    evidencePaths: ["src/app.ts"]
  };
  const genericReceipt = structuredClone(receipt);
  genericReceipt.result.kind = "generic";
  genericReceipt.result.tests = null;
  assert.ok(validateExecutionReceipt(genericReceipt, withReceipt, genericReference).errors.includes("invalid_reference_binding"));
  assert.ok(validateExecutionReceipt(genericReceipt, withReceipt, genericReference).errors.includes("non_promotable_result_kind"));
  assert.throws(() => receiptReference("noop-proof", {
    argv: ["true"], cwd: ".", resultKind: "node_test", evidencePaths: ["src/app.ts"]
  }), /no-op executable/);

  const shellWrapped = structuredClone(receipt);
  shellWrapped.command.argv = ["bash", "-lc", "pnpm test"];
  assert.ok(validateExecutionReceipt(shellWrapped, withReceipt).errors.includes("shell_wrapper_not_allowed"));

  const secretArgv = structuredClone(receipt);
  secretArgv.command.argv = ["tool", "--token", "sensitive-value"];
  assert.ok(validateExecutionReceipt(secretArgv, withReceipt).errors.some((error) => error.startsWith("secret_value_argument:")));
});

test("supplemental fixed dispositions remain open without independent trusted attestation", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = buildIndexSnapshot(root);
  const logPath = `${evidenceRoot}/execution-receipts/supplemental-proof.redacted.txt`;
  const logBytes = Buffer.from("proof output\n");
  write(root, logPath, logBytes);
  git(root, ["add", logPath]);
  const snapshot = buildIndexSnapshot(root);
  assert.equal(snapshot.sourceFingerprintSha256, initial.sourceFingerprintSha256);
  const sourceEntry = snapshot.entriesByPath.get("src/app.ts");
  const receipt = {
    schemaVersion: 1,
    id: "supplemental-proof",
    sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    command: { argv: ["node", "--test", "proof.test.mjs"], cwd: "." },
    runtime: { nodeVersion: "v22.23.4", pnpmVersion: "10.0.0", gitVersion: "git version 2.50.0" },
    result: {
      kind: "node_test",
      status: "passed",
      exitCode: 0,
      signal: null,
      tests: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 }
    },
    log: { path: logPath, sha256: sha256(logBytes), bytes: logBytes.length, redacted: true },
    evidence: [{ path: "src/app.ts", sha256: sourceEntry.sha256 }]
  };
  const receipts = new Map([[receipt.id, { receipt, path: `${evidenceRoot}/execution-receipts/${receipt.id}.json` }]]);
  const definitions = [
    ["PR134-901", "fixed"],
    ["PR134-902", "superseded"],
    ["PR134-903", "deferred_scope"],
    ["PR134-904", "blocked_external"],
    ["PR134-905", "unresolved"],
    ["PR134-906", "fixed"]
  ];
  const findings = definitions.map(([id]) => ({
    id,
    title: id,
    domain: "test",
    relatedBaselineIds: ["ROOT-01"],
    affectedPaths: ["src/app.ts"],
    source: { sourceKey: "test", startLine: 1, endLine: 1 },
    summary: id,
    residualWork: [],
    recordType: "pr134_supplemental_finding"
  }));
  const registry = new Map();
  registerSupplementalDisposition(registry, ["PR134-901"], {
    finalDisposition: "fixed",
    executions: [receiptReference("supplemental-proof", {
      argv: receipt.command.argv, cwd: ".", resultKind: "node_test", evidencePaths: ["src/app.ts"]
    })]
  });
  registerSupplementalDisposition(registry, ["PR134-902"], {
    finalDisposition: "superseded",
    executions: [receiptReference("supplemental-proof", {
      argv: receipt.command.argv, cwd: ".", resultKind: "node_test", evidencePaths: ["src/app.ts"]
    })]
  });
  registerSupplementalDisposition(registry, ["PR134-903"], {
    finalDisposition: "deferred_scope",
    scopeDecision: { authority: "test authority", acceptedBehavior: "not advertised" }
  });
  registerSupplementalDisposition(registry, ["PR134-904"], {
    finalDisposition: "blocked_external",
    externalPrerequisites: [{ owner: "owner", prerequisite: "external proof", proofCommand: "prove", failClosedState: "disabled" }]
  });
  registerSupplementalDisposition(registry, ["PR134-905"], { finalDisposition: "unresolved" });
  registerSupplementalDisposition(registry, ["PR134-906"], {
    finalDisposition: "fixed",
    executions: [receiptReference("missing-proof", {
      argv: receipt.command.argv, cwd: ".", resultKind: "node_test", evidencePaths: ["src/app.ts"]
    })]
  });
  const records = resolveSupplementalRecords(findings, registry, {
    snapshot,
    receipts,
    reviewSources: { test: { name: "test.txt", sha256: "a".repeat(64), lineCount: 1, reviewedHead: "b".repeat(40) } }
  });
  assert.deepEqual(records.map((record) => record.finalDisposition), [
    "unresolved", "unresolved", "deferred_scope", "blocked_external", "unresolved", "unresolved"
  ]);
  assert.equal(records[0].verification.executions[0].receiptValidation, "valid");
  assert.equal(records[0].verification.executions[0].attestationValidation, "unavailable");
  assert.equal(records[0].verification.finalTreeEvidenceRecorded, false);
  assert.equal(records[5].verification.finalTreeEvidenceRecorded, false);
});

test("semantic review records require exact hashes and complete declared coverage", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = buildIndexSnapshot(root);
  const entry = snapshot.entriesByPath.get("src/app.ts");
  const recordPath = `${evidenceRoot}/semantic-reviews/source-review.json`;
  const record = {
    schemaVersion: 1,
    id: "source-review",
    sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    reviewer: { kind: "agent", id: "evidence-reviewer" },
    method: "complete line-by-line semantic read",
    files: [{
      path: "src/app.ts",
      sha256: entry.sha256,
      coverage: "full_semantic",
      lineRanges: [{ startLine: 1, endLine: 1 }],
      findingIds: ["PR134-001"],
      receiptIds: []
    }]
  };
  assert.deepEqual(validateSemanticReviewRecord(record, snapshot, new Map(), recordPath), { valid: true, errors: [] });
  assert.deepEqual(
    reviewClassification("src/app.ts", false, "100644", {
      reviewer: record.reviewer,
      method: record.method,
      coverage: "full_semantic",
      lineRanges: record.files[0].lineRanges
    }),
    {
      status: "current_full_semantic_review_declaration",
      reviewer: "agent:evidence-reviewer",
      method: "complete line-by-line semantic read",
      lineRanges: [{ startLine: 1, endLine: 1 }],
      closureEligible: false,
      independentlyAttested: false,
      limitations: [
        "No approved external trust anchor or independently verified CI attestation was supplied. Tracked receipts and semantic reviews remain declarations."
      ]
    }
  );

  const wrongHash = structuredClone(record);
  wrongHash.files[0].sha256 = "0".repeat(64);
  assert.ok(validateSemanticReviewRecord(wrongHash, snapshot, new Map(), recordPath).errors.includes("review_hash_mismatch:src/app.ts"));

  const partial = structuredClone(record);
  partial.files[0].lineRanges = [];
  assert.ok(validateSemanticReviewRecord(partial, snapshot, new Map(), recordPath).errors.includes("incomplete_review_line_ranges:src/app.ts"));

  assert.equal(reviewClassification("linked-source", true, "120000").status, "symlink_accounted");
  assert.equal(reviewClassification("linked-source", false, "120000").status, "pending");
  assert.equal(reviewClassification("linked-source", false, "120000", {
    reviewer: record.reviewer,
    method: record.method,
    coverage: "full_semantic",
    lineRanges: [{ startLine: 1, endLine: 1 }]
  }).status, "current_full_semantic_review_declaration");
});

test("capture and generation preflights reject mismatched or prohibited index state", (t) => {
  const dirtyRoot = createRepository();
  const stagedRoot = createRepository();
  t.after(() => {
    rmSync(dirtyRoot, { recursive: true, force: true });
    rmSync(stagedRoot, { recursive: true, force: true });
  });
  assert.equal(assertCleanCaptureWorkspace(dirtyRoot), true);
  write(dirtyRoot, "src/app.ts", "export const value = 2;\n");
  assert.throws(() => assertCleanCaptureWorkspace(dirtyRoot), /exactly match the Git index/);
  git(dirtyRoot, ["checkout", "--", "src/app.ts"]);
  write(dirtyRoot, "untracked-proof.txt", "not in the index\n");
  assert.throws(() => assertCleanCaptureWorkspace(dirtyRoot), /untracked=untracked-proof\.txt/);

  const prohibitedPaths = [
    "docs/v2-new-build/current-implementation-status.md",
    "packages/database/migrations/0130_recurring_membership_correctness.sql",
    "packages/database/migrations/0130_recurring_membership_correctness.down.sql"
  ];
  for (const path of prohibitedPaths) write(stagedRoot, path, "staged prohibited bytes\n");
  git(stagedRoot, ["add", ...prohibitedPaths]);
  assert.throws(
    () => assertNoProhibitedStagedPaths(stagedRoot),
    /0130_recurring_membership_correctness\.down\.sql.*0130_recurring_membership_correctness\.sql.*current-implementation-status\.md|current-implementation-status\.md.*0130_recurring_membership_correctness/
  );
});

test("closure state reports unresolved findings and pending coverage", () => {
  const ledger = {
    ledgerState: "working",
    issues: [{ finalDisposition: "unresolved" }],
    supplementalFindings: []
  };
  const manifest = {
    manifestState: "working",
    unresolvedCoverage: [{ path: "src/app.ts" }],
    trustedClosureAttestation: { closureEligible: false }
  };
  assert.deepEqual(finalEvidenceStateErrors(ledger, manifest), [
    "ledger_not_final:working",
    "unresolved_findings:1",
    "manifest_not_final:working",
    "pending_coverage:1",
    "trusted_closure_attestation:unavailable"
  ]);
  assert.deepEqual(finalEvidenceStateErrors(
    { ledgerState: "final", issues: [], supplementalFindings: [] },
    { manifestState: "final", unresolvedCoverage: [], trustedClosureAttestation: { closureEligible: true } }
  ), []);
});

test("command policy rejects shell wrappers and secret-bearing argv", () => {
  assert.equal(commandUsesShellWrapper(["/bin/zsh", "-lc", "pnpm test"]), true);
  assert.equal(commandUsesShellWrapper(["env", "--ignore-environment", "--", "bash", "-lc", "pnpm test"]), true);
  assert.equal(commandUsesShellWrapper(["env", "-S", "zsh -lc 'pnpm test'"]), true);
  assert.equal(commandUsesShellWrapper(["env", "--unknown-option", "bash", "-lc", "pnpm test"]), true);
  assert.equal(commandUsesShellWrapper(["pnpm", "test"]), false);
  assert.ok(secretBearingArgvErrors(["tool", "--password", "value"]).length > 0);
  assert.ok(secretBearingArgvErrors(["tool", "--token=value"]).length > 0);
  assert.ok(secretBearingArgvErrors(["tool", "https://user:pass@example.invalid/path"]).length > 0);
  for (const argument of [
    "SUPABASE_SERVICE_ROLE_KEY=value",
    "GH_TOKEN=value",
    "AWS_SECRET_ACCESS_KEY=value",
    "HELIUS_API_KEY=value",
    "SUPABASE_SECRET_KEY=value",
    "SUMSUB_SECRET_KEY=value",
    "NOTIFICATION_DEVICE_ENCRYPTION_KEY=value",
    "SESSION_COOKIE=value"
  ]) {
    assert.ok(secretBearingArgvErrors(["tool", argument]).length > 0, argument);
  }
  assert.deepEqual(secretBearingArgvErrors(["pnpm", "exec", "vitest", "run"]), []);
});

test("safe writes are atomic/exclusive and reject symlink targets or ancestors", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wevid-safe-write-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "evidence", "receipt.json");
  atomicWriteFileSafe(output, Buffer.from("one\n"), { allowedRoot: root, exclusive: true });
  assert.equal(readFileSync(output, "utf8"), "one\n");
  assert.throws(
    () => atomicWriteFileSafe(output, Buffer.from("two\n"), { allowedRoot: root, exclusive: true }),
    /already exists/
  );
  atomicWriteFileSafe(output, Buffer.from("two\n"), { allowedRoot: root });
  assert.equal(readFileSync(output, "utf8"), "two\n");

  write(root, "real-target.txt", "real\n");
  symlinkSync(join(root, "real-target.txt"), join(root, "target-link.txt"));
  assert.throws(
    () => atomicWriteFileSafe(join(root, "target-link.txt"), Buffer.from("unsafe\n"), { allowedRoot: root }),
    /symlink or special file/
  );

  mkdirSync(join(root, "real-directory"));
  symlinkSync(join(root, "real-directory"), join(root, "ancestor-link"));
  assert.throws(
    () => atomicWriteFileSafe(join(root, "ancestor-link", "nested.txt"), Buffer.from("unsafe\n"), { allowedRoot: root }),
    /real directory/
  );
});

test("changed symlinks reject absolute, ambiguous, and repository-escaping targets", () => {
  assert.equal(
    changedSymlinkCanonicalTarget("supabase/migrations", "../packages/database/migrations"),
    "packages/database/migrations"
  );
  assert.throws(() => changedSymlinkCanonicalTarget("link", "/etc/passwd"), /absolute, empty, or ambiguous/);
  assert.throws(() => changedSymlinkCanonicalTarget("link", "C:\\secrets"), /absolute, empty, or ambiguous/);
  assert.throws(() => changedSymlinkCanonicalTarget("nested/link", "../../outside"), /escapes the repository/);
  assert.throws(() => validateChangedSymlinkEvidence("links/current", "../targets/app.ts", {
    inventoriedPaths: new Set(["links/current"]),
    semanticReviewPaths: new Set()
  }), /not separately inventoried/);
  assert.throws(() => validateChangedSymlinkEvidence("links/current", "../targets/app.ts", {
    inventoriedPaths: new Set(["links/current", "targets/app.ts"]),
    semanticReviewPaths: new Set()
  }), /lacks exact-hash review declarations/);
  assert.equal(validateChangedSymlinkEvidence("links/current", "../targets/app.ts", {
    inventoriedPaths: new Set(["links/current", "targets/app.ts"]),
    semanticReviewPaths: new Set(["targets/app.ts"])
  }).canonicalTargetPath, "targets/app.ts");
});

test("original archive import rejects traversal and content hash mismatch", () => {
  const archiveBytes = Buffer.from("synthetic zip bytes");
  const memberBytes = Buffer.from("member bytes");
  const valid = {
    schemaVersion: 1,
    archive: {
      path: `${evidenceRoot}/audit-inputs/WeVid_Audit_Evidence_71ceabc.zip`,
      sha256: sha256(archiveBytes),
      bytes: archiveBytes.length
    },
    members: [{ path: "finding-index.json", sha256: sha256(memberBytes), bytes: memberBytes.length }]
  };
  const result = validateOriginalEvidenceIndex(valid, () => memberBytes, () => archiveBytes);
  assert.equal(result.memberCount, 1);

  const traversal = structuredClone(valid);
  traversal.members[0].path = "../finding-index.json";
  assert.throws(
    () => validateOriginalEvidenceIndex(traversal, () => memberBytes, () => archiveBytes),
    /Unsafe original evidence archive member path/
  );

  const mismatch = structuredClone(valid);
  mismatch.members[0].sha256 = "0".repeat(64);
  assert.throws(
    () => validateOriginalEvidenceIndex(mismatch, () => memberBytes, () => archiveBytes),
    /member bytes do not match/
  );
});
