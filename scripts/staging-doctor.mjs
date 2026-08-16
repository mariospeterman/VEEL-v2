#!/usr/bin/env node

import { inspectStagingConfiguration } from "./staging-proof-plan.mjs";

const results = inspectStagingConfiguration();

for (const result of results) {
  const details = [
    result.missing.length ? `missing=${result.missing.join(",")}` : "",
    result.invalid.length ? `required=${result.invalid.join(",")}` : ""
  ].filter(Boolean).join(" ");
  console.log(`${result.status} ${result.name}${details ? ` ${details}` : ""}`);
}

const incomplete = results.filter((result) => result.status !== "READY");
if (incomplete.length > 0) process.exitCode = 2;
