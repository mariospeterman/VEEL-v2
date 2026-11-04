#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyMigrationHistory,
  localMigrationRecord
} from "./migration-history-classifier.mjs";

const supabaseBin = resolve("node_modules/.bin/supabase");
const migrationsDir = resolve("packages/database/migrations");
const linkedProjectRefPath = resolve("supabase/.temp/project-ref");

const resolveDatabaseUrl = () => {
  const databaseUrl = process.env.SUPABASE_MIGRATIONS_DB_URL ?? process.env.SUPABASE_DIRECT_DB_URL;
  if (!databaseUrl) fail("SUPABASE_MIGRATIONS_DB_URL or SUPABASE_DIRECT_DB_URL is required. Generic application DATABASE_URL is never used for remote migration inspection.");
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { fail("The configured Supabase database URL is not a valid URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) fail("The configured Supabase database URL must use the postgres/postgresql protocol.");
  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
    parsed.port = "5432";
    console.warn("Using Supabase session pooler port 5432 for migration history checks.");
    return parsed.toString();
  }
  return databaseUrl;
};

const resolveConnectionArgs = () => {
  if (process.env.SUPABASE_MIGRATIONS_DB_URL || process.env.SUPABASE_DIRECT_DB_URL) return ["--db-url", resolveDatabaseUrl()];
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) fail("Set an explicit Supabase migration URL, or provide SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN for the linked Management API path.");
  if (!existsSync(linkedProjectRefPath) || readFileSync(linkedProjectRefPath, "utf8").trim() !== projectRef) {
    fail("The Supabase CLI project is not linked to SUPABASE_PROJECT_REF. Run pnpm supabase:link first.");
  }
  return ["--linked"];
};

const migrations = readdirSync(migrationsDir)
  .filter((fileName) => /^\d+_.+\.sql$/.test(fileName) && !fileName.endsWith(".down.sql"))
  .sort()
  .map((fileName) => localMigrationRecord(fileName, readFileSync(resolve(migrationsDir, fileName), "utf8")));
if (migrations.length === 0) fail("No forward migration files found.");

const connectionArgs = resolveConnectionArgs();
const probe = runQuery(`
  select json_build_object(
    'database', current_database(),
    'history_table_present', to_regclass('supabase_migrations.schema_migrations') is not null
  ) as migration_history_probe;
`, "migration_history_probe");

const historyTablePresent = probe.history_table_present === true;
const remoteMigrations = historyTablePresent
  ? runQuery(`
      select json_build_object(
        'remote_migrations', coalesce(
          json_agg(json_build_object('version', version, 'name', name, 'statements', statements) order by version),
          '[]'::json
        )
      ) as migration_history_status
      from supabase_migrations.schema_migrations;
    `, "migration_history_status").remote_migrations
  : [];

const status = classifyMigrationHistory(migrations, remoteMigrations, { historyTablePresent });
console.log(JSON.stringify({ database: probe.database, ...status }, null, 2));
if (!status.safeToPush) {
  console.error("Remote Supabase migration history is not a clean applied prefix plus expected pending suffix.");
  process.exit(1);
}

function runQuery(query, resultKey) {
  const result = spawnSync(supabaseBin, ["db", "query", ...connectionArgs, "--output", "json", query], {
    encoding: "utf8",
    env: { ...process.env, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "10" },
    timeout: Number(process.env.SUPABASE_CLI_TIMEOUT_MS ?? 45_000)
  });
  if (result.error?.name === "TimeoutError" || result.signal === "SIGTERM") {
    console.error("Supabase migration history check timed out.");
    process.exit(124);
  }
  if (result.status !== 0) {
    console.error("Supabase migration history check failed.");
    if (result.stderr) console.error(redactSecrets(result.stderr));
    process.exit(result.status ?? 1);
  }
  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart === -1) fail("Supabase migration history check returned unexpected output.");
  const payload = JSON.parse(result.stdout.slice(jsonStart));
  const value = payload.rows?.[0]?.[resultKey];
  if (!value || typeof value !== "object") fail("Supabase migration history check returned an unexpected resource shape.");
  return value;
}

function redactSecrets(message) {
  return [process.env.SUPABASE_MIGRATIONS_DB_URL, process.env.SUPABASE_DIRECT_DB_URL]
    .filter(Boolean)
    .reduce((output, value) => output.replaceAll(value, "[redacted-db-url]"), message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
