#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectStagingEnvironment } from "./staging-config.mjs";
import {
  deriveAcceptanceOverall,
  deriveJourneyResults
} from "./staging-acceptance-status.mjs";
import {
  executeStagingProofPlan,
  stagingProofPlan
} from "./staging-proof-plan.mjs";

const startedAt = new Date();
const manifest = JSON.parse(await readFile("docs/v2-new-build/operator/staging-acceptance.json", "utf8"));
const configuration = inspectStagingEnvironment();
const invalid = configuration.some((entry) => entry.status === "INVALID");
const blocked = configuration.some((entry) => entry.status === "BLOCKED");
const commands = commandPlan().map((entry) => ({ ...entry, status: "NOT_RUN", reason: "configuration_not_ready" }));
let proofs = stagingProofPlan.map((proof) => ({ name: proof.name, status: "not_run", reason: "configuration_not_ready" }));

if (!invalid && !blocked) {
  commands[0] = await runCommandOutcome(commands[0]);
  if (commands[0].status === "PASS") {
    commands[1] = await runCommandOutcome(commands[1], releaseVerificationEnv());
  }

  if (commands[1].status === "PASS") {
    const proofEnv = { ...process.env, ...releaseVerificationEnv() };
    proofs = await executeStagingProofPlan({
      env: proofEnv,
      runCommand: (command, args) => run(command, args, proofEnv)
    });
    commands[2] = await runCommandOutcome(commands[2]);
  } else {
    commands[2] = { ...commands[2], reason: "release_prerequisite_not_passed" };
    proofs = proofs.map((proof) => ({ ...proof, reason: "release_prerequisite_not_passed" }));
  }
}

const releaseManifest = await readJsonFile(process.env.RELEASE_MANIFEST_PATH);
const evidenceBundle = parseJson(process.env.STAGING_EVIDENCE_BUNDLE_JSON);
const capabilityStatus = new Map(configuration.map((entry) => [entry.name, entry.status]));
const journeys = deriveJourneyResults({
  journeys: manifest.journeys,
  capabilityStatus,
  proofOutcomes: proofs,
  evidenceBundle,
  releaseManifest
});
const overall = deriveAcceptanceOverall({ configuration, commands, proofs, journeys });
const result = {
  schemaVersion: 2,
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  releaseSha: releaseManifest?.sourceSha ?? process.env.GIT_SHA ?? null,
  releaseManifestDigest: releaseManifest?.manifestDigest ?? null,
  environment: "staging",
  overall,
  configuration,
  commands,
  proofs,
  journeys
};

const output = path.resolve(process.env.STAGING_ACCEPTANCE_OUTPUT ?? ".staging/acceptance/latest.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
for (const proof of result.proofs) console.log(`${proof.status.toUpperCase()} proof=${proof.name}`);
for (const journey of result.journeys) console.log(`${journey.status} ${journey.id}`);
console.log(`${overall} report=${path.relative(process.cwd(), output)}`);

if (overall === "UNSAFE_TARGET") process.exitCode = 3;
else if (overall === "BLOCKED_CONFIGURATION" || overall === "INCOMPLETE") process.exitCode = 2;
else if (overall === "FAIL") process.exitCode = 1;

function commandPlan() {
  return [
    {
      name: "cloud-link",
      command: "pnpm",
      args: ["staging:cloud:link"]
    },
    {
      name: "release-manifest-verification",
      command: "node",
      args: ["scripts/verify-release-manifest.mjs"]
    },
    {
      name: "staging-browser",
      command: "node",
      args: ["scripts/run-local-tool.mjs", "playwright", "test", "--config=playwright.staging.config.ts"]
    }
  ];
}

async function runCommandOutcome(entry, envOverrides = {}) {
  try {
    await run(entry.command, entry.args, { ...process.env, ...envOverrides });
    return { ...entry, status: "PASS", reason: null };
  } catch (error) {
    return {
      ...entry,
      status: error?.exitCode === 2 ? "BLOCKED" : "FAIL",
      reason: safeReason(error)
    };
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${command} exited ${code}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

function releaseVerificationEnv() {
  return {
    RELEASE_EXPECTED_SHA: process.env.GIT_SHA,
    RELEASE_VERIFY_SOURCE: "true"
  };
}

async function readJsonFile(filePath) {
  if (!filePath?.trim()) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseJson(value) {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { journeyOutcomes: "invalid_json" };
  }
}

function safeReason(error) {
  return (error instanceof Error ? error.message : "command_failed").replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
}
