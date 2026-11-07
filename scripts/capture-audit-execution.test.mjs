import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCaptureSnapshotUnchanged,
  buildMinimalChildEnvironment,
  finalReceiptSecretErrors,
  parseTestResult,
  redactExecutionOutput,
  validateCaptureTargetPaths
} from "./capture-audit-execution.mjs";

test("Vitest result parsing records nonzero collected tests", () => {
  assert.deepEqual(
    parseTestResult("vitest", " Test Files  1 passed (1)\n      Tests  7 passed | 2 skipped (9)\n"),
    { passed: 7, failed: 0, skipped: 2, todo: 0, total: 9 }
  );
  assert.deepEqual(
    parseTestResult("vitest", " Test Files  1 failed (1)\n      Tests  no tests\n"),
    { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 }
  );
});

test("Node test and Playwright summaries retain pass, failure, and skip counts", () => {
  assert.deepEqual(
    parseTestResult("node_test", "# tests 5\n# pass 3\n# fail 1\n# skipped 1\n# todo 0\n"),
    { total: 5, passed: 3, failed: 1, skipped: 1, todo: 0 }
  );
  assert.deepEqual(
    parseTestResult("playwright", "  15 failed\n  3 skipped\n  217 passed (2.3m)\n"),
    { passed: 217, failed: 15, skipped: 3, todo: 0, total: 235 }
  );
});

test("captured output redacts common credential forms before writing logs", () => {
  const redacted = redactExecutionOutput([
    "Authorization: Bearer abc.def.ghi",
    "DATABASE_URL=postgresql://user:pass@example.invalid/db",
    "service_role_key=unquoted-service-secret",
    "SUPABASE_SERVICE_ROLE_KEY=supabase-secret",
    "GH_TOKEN=github-secret",
    "AWS_SECRET_ACCESS_KEY=aws-secret",
    "HELIUS_API_KEY=helius-secret",
    "SUPABASE_SECRET_KEY=supabase-key-secret",
    "SUMSUB_SECRET_KEY=sumsub-key-secret",
    "NOTIFICATION_DEVICE_ENCRYPTION_KEY=encryption-key-secret",
    "SESSION_COOKIE=session-secret",
    "api_key=secret-value",
    "{\"token\":\"json-secret\",\"safe\":true}",
    "https://example.invalid/path?token=query-secret",
    "https://named:credential@example.invalid/path",
    "eyJabcdefghijk.abcdefghijkl.abcdefghijkl"
  ].join("\n"));
  assert.doesNotMatch(redacted, /user:pass|unquoted-service-secret|supabase-secret|github-secret|aws-secret|helius-secret|supabase-key-secret|sumsub-key-secret|encryption-key-secret|session-secret|secret-value|json-secret|query-secret|named:credential|abc\.def\.ghi/);
  assert.match(redacted, /\[REDACTED\]/);
  assert.deepEqual(finalReceiptSecretErrors(Buffer.from(redacted), Buffer.from("{}\n")), []);
  assert.ok(finalReceiptSecretErrors(
    Buffer.from("GH_TOKEN=unredacted-value\n"),
    Buffer.from("{}\n")
  ).includes("log:unredacted_secret_pattern"));
  assert.ok(finalReceiptSecretErrors(
    Buffer.from("opaque environment value: environment-secret\n"),
    Buffer.from("{}\n"),
    ["environment-secret"]
  ).includes("log:known_sensitive_value_present"));
});

test("capture child environment is an explicit allowlist and snapshots are rechecked", () => {
  const environment = buildMinimalChildEnvironment({
    PATH: "/bin",
    HOME: "/tmp/home",
    LANG: "C",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    GH_TOKEN: "secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    HELIUS_API_KEY: "secret",
    SUPABASE_SECRET_KEY: "secret",
    SUMSUB_SECRET_KEY: "secret",
    NOTIFICATION_DEVICE_ENCRYPTION_KEY: "secret",
    SESSION_COOKIE: "secret"
  });
  assert.deepEqual(environment, { PATH: "/bin", HOME: "/tmp/home", LANG: "C" });

  const before = {
    sourceFingerprintSha256: "a".repeat(64),
    entries: [{ path: "src/app.ts", mode: "100644", sha256: "b".repeat(64) }]
  };
  assert.equal(assertCaptureSnapshotUnchanged(before, structuredClone(before)), true);
  const changed = structuredClone(before);
  changed.entries[0].sha256 = "c".repeat(64);
  assert.throws(() => assertCaptureSnapshotUnchanged(before, changed), /changed the Git index/);
});

test("capture targets use trackable receipt and redacted-log suffixes", () => {
  const prefix = "docs/v2-new-build/audit-evidence/71ceabc/execution-receipts";
  assert.equal(validateCaptureTargetPaths(`${prefix}/proof.json`, `${prefix}/proof.redacted.txt`), true);
  assert.throws(() => validateCaptureTargetPaths(`${prefix}/proof.json`, `${prefix}/proof.log`), /\.redacted\.txt/);
  assert.throws(() => validateCaptureTargetPaths(`${prefix}/proof.txt`, `${prefix}/proof.redacted.txt`), /\.json/);
});
