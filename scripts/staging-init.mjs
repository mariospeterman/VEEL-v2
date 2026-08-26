#!/usr/bin/env node
import { constants } from "node:fs";
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
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

const current = await readFile(target, "utf8");
const normalized = current.replace(/^([A-Z][A-Z0-9_]*)= #/gm, '$1="" #');
if (normalized !== current) {
  await writeFile(target, normalized, "utf8");
  console.log("Normalized legacy blank staging entries without changing configured values.");
}
await chmod(target, 0o600);

for (const capability of stagingCapabilities) {
  const exposure = [...new Set(capability.variables.map((entry) => entry.exposure))].join("+");
  console.log(`${capability.required ? "required" : "optional"} ${capability.name} ${exposure}`);
}
console.log("Next: set values without committing them, then run pnpm staging:doctor --json.");
console.log("Guide: infra/deploy/staging-convergence.md");
