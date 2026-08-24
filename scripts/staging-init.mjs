#!/usr/bin/env node
import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stagingCapabilities } from "./staging-config.mjs";

const source = path.resolve(".env.staging.example");
const target = path.resolve(".env.staging");

await readFile(source, "utf8");
try {
  await copyFile(source, target, constants.COPYFILE_EXCL);
  console.log("Created .env.staging from the secret-free staging template.");
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  console.log("Kept existing .env.staging unchanged.");
}

for (const capability of stagingCapabilities) {
  const exposure = [...new Set(capability.variables.map((entry) => entry.exposure))].join("+");
  console.log(`${capability.required ? "required" : "optional"} ${capability.name} ${exposure}`);
}
console.log("Next: set values without committing them, then run pnpm staging:doctor --json.");
console.log("Guide: infra/deploy/staging-convergence.md");
