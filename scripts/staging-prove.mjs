#!/usr/bin/env node
import { spawn } from "node:child_process";
import { executeStagingProofPlan } from "./staging-proof-plan.mjs";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

const outcomes = await executeStagingProofPlan({ runCommand: run });
for (const outcome of outcomes) {
  if (outcome.status === "blocked") {
    console.log(`CODE_COMPLETE_PROVIDER_BLOCKED ${outcome.name} missing=${outcome.missing.join(",")}`);
  } else if (outcome.status === "failed") {
    console.error(`PROOF_FAILED ${outcome.name} reason=${outcome.reason}`);
  } else if (outcome.status === "evidence_registered") {
    console.log(`EVIDENCE_REGISTERED ${outcome.name}`);
  } else if (outcome.status === "skipped") {
    console.log(`PROOF_SKIPPED ${outcome.name} reason=${outcome.reason}`);
  } else {
    console.log(`PROOF_PASSED ${outcome.name}`);
  }
}

if (outcomes.some((outcome) => outcome.status === "failed")) process.exitCode = 1;
else if (outcomes.some((outcome) => outcome.status === "blocked")) process.exitCode = 2;
