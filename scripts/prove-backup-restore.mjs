#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const backupDirectory = path.resolve(process.env.BACKUP_INPUT_DIR ?? "");
const target = process.env.RESTORE_TARGET_DB_URL;
if (!process.env.BACKUP_INPUT_DIR || !target) throw new Error("BACKUP_INPUT_DIR and RESTORE_TARGET_DB_URL are required");
if (process.env.RESTORE_PROOF_ACK !== "RESTORE_DISPOSABLE_NONPRODUCTION_DATABASE") {
  throw new Error("Restore proof requires RESTORE_PROOF_ACK=RESTORE_DISPOSABLE_NONPRODUCTION_DATABASE");
}
const url = new URL(target);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.pathname.toLowerCase().includes("restore")) {
  throw new Error("Restore proof target must be a loopback database whose name contains 'restore'");
}
for (const name of ["roles.sql", "schema.sql", "data.sql"]) await access(path.join(backupDirectory, name));

function psql(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PSQL_BINARY ?? "psql", [target, "--set", "ON_ERROR_STOP=1", ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`psql exited ${code}`)));
  });
}
const restoreFiles = process.env.RESTORE_SKIP_ROLES === "true"
  ? ["schema.sql", "data.sql"]
  : ["roles.sql", "schema.sql", "data.sql"];
await psql([
  "--command",
  "do $$ declare required_schema text; begin foreach required_schema in array array['auth', 'storage', 'supabase_functions'] loop if to_regnamespace(required_schema) is null then raise exception 'restore target must be provisioned by Supabase (missing schema: %)', required_schema; end if; end loop; end $$;"
]);
for (const name of restoreFiles) await psql(["--file", path.join(backupDirectory, name)]);
await psql([
  "--command",
  "do $$ declare required_table text; begin foreach required_table in array array['users', 'audit_events', 'payment_intents', 'entitlements', 'provider_events'] loop if to_regclass('public.' || required_table) is null then raise exception 'logical restore is missing required WeVid table: %', required_table; end if; end loop; end $$;"
]);
await psql(["--tuples-only", "--command", "select count(*) from pg_tables where schemaname = 'public';"]);
console.log("Non-production logical restore proof passed; the target may now be discarded.");
