#!/usr/bin/env node

import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertSafeWriteTarget,
  assertCleanCaptureWorkspace,
  assertNoProhibitedStagedPaths,
  atomicWriteFileSafe,
  buildIndexSnapshot,
  commandLooksTestLike,
  commandUsesShellWrapper,
  redactCommandArgv,
  redactSecretText,
  secretBearingArgvErrors,
  secretBearingTextErrors,
  stableJson
} from "./generate-audit-evidence.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const receiptDirectory = "docs/v2-new-build/audit-evidence/71ceabc/execution-receipts";
const allowedKinds = new Set(["generic", "vitest", "node_test", "playwright"]);
const childEnvironmentAllowlist = new Set([
  "CI", "COLORTERM", "COMSPEC", "FORCE_COLOR", "HOME", "LANG", "LC_ALL", "LC_CTYPE",
  "NODE_ENV", "NO_COLOR", "PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "TZ"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(message);
}

function toRepositoryPath(path, label) {
  const absolutePath = resolve(repositoryRoot, path);
  const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (repositoryPath === ".." || repositoryPath.startsWith("../") || resolve(repositoryRoot, repositoryPath) !== absolutePath) {
    fail(`${label} must stay inside the repository`);
  }
  return { absolutePath, repositoryPath };
}

export function validateCaptureTargetPaths(receiptPath, logPath) {
  if (!receiptPath.startsWith(`${receiptDirectory}/`) || !receiptPath.endsWith(".json")) {
    fail(`Receipt must be a .json file below ${receiptDirectory}`);
  }
  if (!logPath.startsWith(`${receiptDirectory}/`) || !logPath.endsWith(".redacted.txt")) {
    fail(`Log must be a .redacted.txt file below ${receiptDirectory}`);
  }
  if (receiptPath === logPath) fail("Receipt and log paths must be distinct");
  return true;
}

function parseArguments(argv) {
  let id = null;
  let receiptPath = null;
  let logPath = null;
  let kind = "generic";
  const evidencePaths = [];
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      command = argv.slice(index + 1);
      break;
    }
    if (argument === "--id") {
      id = argv[++index];
    } else if (argument === "--receipt") {
      receiptPath = argv[++index];
    } else if (argument === "--log") {
      logPath = argv[++index];
    } else if (argument === "--kind") {
      kind = argv[++index];
    } else if (argument === "--evidence") {
      evidencePaths.push(argv[++index]);
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/capture-audit-execution.mjs --id ID " +
        "[--kind generic|vitest|node_test|playwright] [--evidence PATH ...] " +
        "[--receipt PATH] [--log PATH] -- COMMAND [ARG ...]\n"
      );
      process.exit(0);
    } else {
      fail(`Unknown argument before --: ${argument}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/.test(id ?? "")) fail("--id must be a stable lowercase receipt ID");
  if (!allowedKinds.has(kind)) fail(`Unsupported --kind: ${kind}`);
  if (!command || command.length === 0 || command.some((value) => typeof value !== "string" || value.length === 0)) {
    fail("A direct command argv is required after --");
  }
  return {
    id,
    kind,
    command,
    evidencePaths,
    receiptPath: receiptPath ?? `${receiptDirectory}/${id}.json`,
    logPath: logPath ?? `${receiptDirectory}/${id}.redacted.txt`
  };
}

export function redactExecutionOutput(value) {
  return redactSecretText(value);
}

export function buildMinimalChildEnvironment(source = process.env) {
  const environment = {};
  for (const key of childEnvironmentAllowlist) {
    if (typeof source[key] === "string") environment[key] = source[key];
  }
  if (!environment.PATH) fail("PATH is required in the minimal child environment");
  return environment;
}

function sensitiveEnvironmentValues(source = process.env) {
  return Object.entries(source)
    .filter(([key, value]) => typeof value === "string" && value.length >= 4 &&
      secretBearingArgvErrors([`${key}=${value}`]).length > 0)
    .map(([, value]) => value);
}

function stripAnsi(value) {
  // ANSI CSI sequences begin with ESC, so the control character is intentional here.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sumResultTokens(line) {
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped|pending|todo)\b/gi)) {
    const key = match[2].toLowerCase() === "pending" ? "skipped" : match[2].toLowerCase();
    counts[key] += Number(match[1]);
  }
  return counts;
}

export function parseTestResult(kind, output) {
  const clean = stripAnsi(output);
  if (kind === "generic") return null;
  if (kind === "vitest") {
    const testsLine = clean.split(/\r?\n/).find((line) => /^\s*Tests\s+/i.test(line));
    const counts = testsLine ? sumResultTokens(testsLine) : { passed: 0, failed: 0, skipped: 0, todo: 0 };
    return { ...counts, total: counts.passed + counts.failed + counts.skipped + counts.todo };
  }
  if (kind === "node_test") {
    const valueFor = (label) => Number(clean.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? 0);
    const total = valueFor("tests");
    return {
      total,
      passed: valueFor("pass"),
      failed: valueFor("fail"),
      skipped: valueFor("skipped"),
      todo: valueFor("todo")
    };
  }
  const summaryLines = clean.split(/\r?\n/).filter((line) => /\b(?:passed|failed|skipped)\b/i.test(line));
  const counts = summaryLines.reduce((combined, line) => {
    const parsed = sumResultTokens(line);
    for (const key of Object.keys(combined)) combined[key] += parsed[key];
    return combined;
  }, { passed: 0, failed: 0, skipped: 0, todo: 0 });
  return { ...counts, total: counts.passed + counts.failed + counts.skipped + counts.todo };
}

function toolVersion(executable, args, environment) {
  const result = spawnSync(executable, args, { cwd: repositoryRoot, env: environment, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function snapshotIdentity(snapshot) {
  return stableJson(snapshot.entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    sha256: entry.sha256
  })));
}

export function assertCaptureSnapshotUnchanged(before, after) {
  if (before.sourceFingerprintSha256 !== after.sourceFingerprintSha256 ||
      snapshotIdentity(before) !== snapshotIdentity(after)) {
    fail("Execution changed the Git index/source snapshot; refusing to write a receipt");
  }
  return true;
}

export function finalReceiptSecretErrors(logBytes, receiptBytes, sensitiveValues = []) {
  return [
    ...secretBearingTextErrors(logBytes.toString("utf8"), sensitiveValues).map((error) => `log:${error}`),
    ...secretBearingTextErrors(receiptBytes.toString("utf8"), sensitiveValues).map((error) => `receipt:${error}`)
  ];
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  assertNoProhibitedStagedPaths(repositoryRoot);
  assertCleanCaptureWorkspace(repositoryRoot);
  if (commandUsesShellWrapper(options.command)) fail("Shell-wrapper commands are not permitted in execution receipts");
  const secretArgvErrors = secretBearingArgvErrors(options.command);
  if (secretArgvErrors.length > 0) {
    fail(`Secret-bearing command arguments are not permitted: ${secretArgvErrors.join(", ")}`);
  }
  const storedCommand = redactCommandArgv(options.command);
  const snapshot = buildIndexSnapshot(repositoryRoot);
  const receiptTarget = toRepositoryPath(options.receiptPath, "Receipt path");
  const logTarget = toRepositoryPath(options.logPath, "Log path");
  validateCaptureTargetPaths(receiptTarget.repositoryPath, logTarget.repositoryPath);
  assertSafeWriteTarget(receiptTarget.absolutePath, { allowedRoot: repositoryRoot, exclusive: true });
  assertSafeWriteTarget(logTarget.absolutePath, { allowedRoot: repositoryRoot, exclusive: true });
  const evidence = options.evidencePaths.map((path) => {
    const repositoryPath = toRepositoryPath(path, "Evidence path").repositoryPath;
    const entry = snapshot.entriesByPath.get(repositoryPath);
    if (!entry) fail(`Evidence path is not a tracked stage-zero index file: ${repositoryPath}`);
    return { path: repositoryPath, sha256: entry.sha256 };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  const childEnvironment = buildMinimalChildEnvironment();
  const sensitiveValues = sensitiveEnvironmentValues();
  const execution = spawnSync(options.command[0], options.command.slice(1), {
    cwd: repositoryRoot,
    env: childEnvironment,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  const stdout = redactExecutionOutput(execution.stdout ?? "");
  const stderr = redactExecutionOutput(execution.stderr ?? "");
  const commandFailure = execution.error ? `${execution.error.name}: ${execution.error.message}\n` : "";
  const redactedLog = [
    `$ ${storedCommand.map((value) => JSON.stringify(value)).join(" ")}`,
    "[stdout]",
    stdout,
    "[stderr]",
    stderr,
    commandFailure
  ].join("\n");
  const logBytes = Buffer.from(redactedLog.endsWith("\n") ? redactedLog : `${redactedLog}\n`);
  const tests = parseTestResult(options.kind, `${stdout}\n${stderr}`);
  const exitCode = execution.status ?? 1;
  const runtime = {
    nodeVersion: process.version,
    pnpmVersion: toolVersion("pnpm", ["--version"], childEnvironment),
    gitVersion: toolVersion("git", ["--version"], childEnvironment),
    platform: process.platform,
    arch: process.arch
  };
  const status = exitCode !== 0
    ? "failed"
    : !runtime.pnpmVersion || !runtime.gitVersion
      ? "invalid_runtime_versions"
    : options.kind === "generic" && commandLooksTestLike(options.command)
      ? "invalid_unstructured_test_result"
    : options.kind !== "generic" && (!tests || tests.total <= 0)
      ? "invalid_zero_tests"
    : options.kind !== "generic" && (!Number.isInteger(tests?.passed) || tests.passed <= 0)
      ? "invalid_all_tests_skipped"
      : "passed";
  const receipt = {
    schemaVersion: 1,
    id: options.id,
    sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    command: { argv: storedCommand, cwd: "." },
    runtime,
    result: {
      kind: options.kind,
      status,
      exitCode,
      signal: execution.signal ?? null,
      tests
    },
    log: {
      path: logTarget.repositoryPath,
      sha256: sha256(logBytes),
      bytes: logBytes.length,
      redacted: true,
      redactionPolicyVersion: 1
    },
    evidence
  };
  const receiptBytes = Buffer.from(stableJson(receipt));
  const finalSecretErrors = finalReceiptSecretErrors(logBytes, receiptBytes, sensitiveValues);
  if (finalSecretErrors.length > 0) {
    fail(`Final receipt/log bytes failed the secret scan: ${finalSecretErrors.join(", ")}`);
  }

  assertNoProhibitedStagedPaths(repositoryRoot);
  assertCleanCaptureWorkspace(repositoryRoot);
  const postExecutionSnapshot = buildIndexSnapshot(repositoryRoot);
  assertCaptureSnapshotUnchanged(snapshot, postExecutionSnapshot);

  atomicWriteFileSafe(logTarget.absolutePath, logBytes, { allowedRoot: repositoryRoot, exclusive: true });
  atomicWriteFileSafe(receiptTarget.absolutePath, receiptBytes, { allowedRoot: repositoryRoot, exclusive: true });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(`\nCaptured ${options.id}: ${status}; receipt=${receiptTarget.repositoryPath}; log=${logTarget.repositoryPath}\n`);
  process.exitCode = status === "passed" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main();
