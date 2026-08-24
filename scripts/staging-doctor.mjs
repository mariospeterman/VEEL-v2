#!/usr/bin/env node
import { inspectStagingEnvironment } from "./staging-config.mjs";

const json = process.argv.includes("--json");
const results = inspectStagingEnvironment();

if (json) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, capabilities: results }, null, 2)}\n`);
} else {
  for (const result of results) {
    const details = [
      result.missing.length ? `missing=${result.missing.join(",")}` : "",
      result.invalid.length ? `invalid=${result.invalid.join(",")}` : ""
    ].filter(Boolean).join(" ");
    console.log(`${result.status} ${result.name}${details ? ` ${details}` : ""}`);
  }
}

if (results.some((result) => result.status === "INVALID")) process.exitCode = 3;
else if (results.some((result) => result.status === "BLOCKED")) process.exitCode = 2;
