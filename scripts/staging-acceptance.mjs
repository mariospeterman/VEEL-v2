#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectStagingEnvironment } from "./staging-config.mjs";
import { deriveJourneyResults } from "./staging-acceptance-status.mjs";

const startedAt = new Date();
const manifest = JSON.parse(await readFile("docs/v2-new-build/operator/staging-acceptance.json", "utf8"));
const configuration = inspectStagingEnvironment();
const invalid = configuration.some((entry) => entry.status === "INVALID");
const blocked = configuration.some((entry) => entry.status === "BLOCKED");
const outcomes = [];

if (!invalid && !blocked) {
  for (const command of [
    ["pnpm", ["staging:cloud:link"]],
    ["node", ["scripts/verify-release-manifest.mjs"]],
    ["pnpm", ["staging:prove"]],
    ["node", ["scripts/run-local-tool.mjs", "playwright", "test", "--config=playwright.staging.config.ts"]]
  ]) {
    try {
      await run(command[0], command[1]);
      outcomes.push({ command: `${command[0]} ${command[1].join(" ")}`, status: "PASS" });
    } catch (error) {
      outcomes.push({ command: `${command[0]} ${command[1].join(" ")}`, status: "FAIL", reason: safeReason(error) });
      break;
    }
  }
}

const commandFailed = outcomes.some((outcome) => outcome.status === "FAIL");
const overall = invalid ? "UNSAFE_TARGET" : blocked ? "BLOCKED_CONFIGURATION" : commandFailed ? "FAIL" : "PASS";
const capabilityStatus = new Map(configuration.map((entry) => [entry.name, entry.status]));
const result = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  releaseSha: process.env.GIT_SHA ?? null,
  environment: "staging",
  overall,
  configuration,
  commands: outcomes,
  journeys: deriveJourneyResults({ journeys: manifest.journeys, capabilityStatus })
};

const output = path.resolve(process.env.STAGING_ACCEPTANCE_OUTPUT ?? ".staging/acceptance/latest.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
for (const journey of result.journeys) console.log(`${journey.status} ${journey.id}`);
console.log(`${overall} report=${path.relative(process.cwd(), output)}`);

if (overall === "UNSAFE_TARGET") process.exitCode = 3;
else if (overall === "BLOCKED_CONFIGURATION") process.exitCode = 2;
else if (overall === "FAIL") process.exitCode = 1;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function safeReason(error) {
  return (error instanceof Error ? error.message : "command_failed").replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
}
