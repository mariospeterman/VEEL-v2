#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const path = process.env.STAGING_ACCEPTANCE_OUTPUT ?? ".staging/acceptance/latest.json";
const result = JSON.parse(await readFile(path, "utf8"));
console.log(`release=${result.releaseSha ?? "unknown"} environment=${result.environment} overall=${result.overall}`);
for (const journey of result.journeys) console.log(`${journey.status} ${journey.id}`);
const failed = result.overall === "FAIL" || result.overall === "UNSAFE_TARGET"
  || result.journeys.some((journey) => journey.status === "FAIL");
const stagingProven = result.overall === "PASS"
  && result.journeys.every((journey) => ["PASS", "DEFERRED"].includes(journey.status));
const terminalState = stagingProven
  ? "STAGING_PROVEN"
  : failed
    ? "NOT_OPERATOR_READY"
    : "OPERATOR_READY_FOR_STAGING_CONFIGURATION";
console.log(`terminal=${terminalState}`);
if (failed) process.exitCode = 1;
