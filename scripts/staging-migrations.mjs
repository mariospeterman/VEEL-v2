#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeStagingTarget, environmentFingerprint, expectedMigrationHead } from "./staging-config.mjs";

const mode = process.argv[2];
if (!new Set(["plan", "apply"]).has(mode)) throw new Error("Use plan or apply");
assertSafeStagingTarget();

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) throw new Error("SUPABASE_PROJECT_REF is required");
const head = expectedMigrationHead();

await run("pnpm", ["supabase:history:check"]);
await run("pnpm", ["supabase:push:dry"]);

if (mode === "plan") {
  console.log(`READY migration_plan project=${projectRef} expected_head=${head}`);
  process.exit(0);
}

const expectedAck = `${projectRef}:${head}`;
if (process.env.STAGING_SCHEMA_APPLY_ACK !== expectedAck) {
  console.error(`BLOCKED migration_apply acknowledgement_required=${projectRef}:<expected-migration-head>`);
  process.exit(2);
}
if (process.env.STAGING_BACKUP_ACK !== "BACKUP_CONFIRMED_OR_DISPOSABLE_STAGING") {
  console.error("BLOCKED migration_apply backup_acknowledgement_required");
  process.exit(2);
}

await run("pnpm", ["supabase:push"]);
const receiptDirectory = path.resolve(".staging/receipts");
await mkdir(receiptDirectory, { recursive: true });
const receipt = {
  schemaVersion: 1,
  projectRef,
  expectedMigrationHead: head,
  environmentFingerprint: environmentFingerprint(),
  appliedAt: new Date().toISOString()
};
const receiptPath = path.join(receiptDirectory, `migration-${Date.now()}.json`);
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`READY migration_apply receipt=${path.relative(process.cwd(), receiptPath)}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
