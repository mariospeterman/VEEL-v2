#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const supabaseBin = resolve("node_modules/.bin/supabase");
const supabaseConfig = resolve("supabase/config.toml");
const supabaseTempDir = resolve("supabase/.temp");
const canonicalMigrationsDir = resolve("packages/database/migrations");
const linkedProjectRefPath = resolve(supabaseTempDir, "project-ref");

if (!existsSync(supabaseBin)) {
  console.error("Local Supabase CLI was not found. Run pnpm install first.");
  process.exit(1);
}

const resolveDatabaseUrl = () => {
  const databaseUrl =
    process.env.SUPABASE_MIGRATIONS_DB_URL ??
    process.env.SUPABASE_DIRECT_DB_URL;

  if (!databaseUrl) {
    console.error("SUPABASE_MIGRATIONS_DB_URL or SUPABASE_DIRECT_DB_URL is required. Generic application DATABASE_URL is never used for remote migration commands.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    console.error("The configured Supabase database URL is not a valid URL.");
    process.exit(1);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("The configured Supabase database URL must use the postgres/postgresql protocol.");
    process.exit(1);
  }

  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
    parsed.port = "5432";
    console.warn("Using Supabase session pooler port 5432 for migration CLI commands; transaction pooler port 6543 does not support prepared statements.");
    return parsed.toString();
  }

  return databaseUrl;
};

const resolveConnectionArgs = () => {
  if (process.env.SUPABASE_MIGRATIONS_DB_URL || process.env.SUPABASE_DIRECT_DB_URL) {
    return ["--db-url", resolveDatabaseUrl()];
  }

  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("Set an explicit Supabase migration URL, or provide SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN for the linked Management API path.");
    process.exit(1);
  }
  if (!existsSync(linkedProjectRefPath) || readFileSync(linkedProjectRefPath, "utf8").trim() !== projectRef) {
    console.error("The Supabase CLI project is not linked to SUPABASE_PROJECT_REF. Run pnpm supabase:link first.");
    process.exit(1);
  }

  return ["--linked"];
};

const args = process.argv.slice(2).flatMap((arg) => {
  if (arg === "--project-ref-env") {
    const projectRef = process.env.SUPABASE_PROJECT_REF;
    if (!projectRef) {
      console.error("SUPABASE_PROJECT_REF is required.");
      process.exit(1);
    }
    return ["--project-ref", projectRef];
  }

  if (arg === "--db-url-env") {
    return ["--db-url", resolveDatabaseUrl()];
  }

  if (arg === "--connection-env") {
    return resolveConnectionArgs();
  }

  return [arg];
});

const isLocalStart = args[0] === "start";
const needsMigrationWorkdir = ["db", "migration", "start"].includes(args[0]);
const workdir = needsMigrationWorkdir ? mkdtempSync(resolve(tmpdir(), "veel-supabase-")) : process.cwd();

if (needsMigrationWorkdir) {
  const generatedSupabaseDir = resolve(workdir, "supabase");
  const generatedMigrationsDir = resolve(generatedSupabaseDir, "migrations");
  const generatedTempDir = resolve(generatedSupabaseDir, ".temp");
  mkdirSync(generatedMigrationsDir, { recursive: true });
  copyFileSync(supabaseConfig, resolve(generatedSupabaseDir, "config.toml"));

  if (existsSync(supabaseTempDir)) {
    mkdirSync(generatedTempDir, { recursive: true });
    for (const fileName of readdirSync(supabaseTempDir)) {
      copyFileSync(resolve(supabaseTempDir, fileName), resolve(generatedTempDir, fileName));
    }
  }

  for (const fileName of readdirSync(canonicalMigrationsDir).sort()) {
    if (!/^\d+_.+\.sql$/.test(fileName) || fileName.endsWith(".down.sql")) {
      continue;
    }

    symlinkSync(
      resolve(canonicalMigrationsDir, fileName),
      resolve(generatedMigrationsDir, fileName)
    );
  }
}

const result = spawnSync(supabaseBin, args, {
  cwd: workdir,
  stdio: "inherit",
  env: {
    ...process.env,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "10"
  },
  timeout: Number(
    process.env.SUPABASE_CLI_TIMEOUT_MS ?? (isLocalStart ? 300_000 : 45_000)
  )
});

if (needsMigrationWorkdir) {
  rmSync(workdir, { recursive: true, force: true });
}

if (result.error?.name === "TimeoutError" || result.signal === "SIGTERM") {
  console.error("Supabase CLI command timed out. Check the explicit Supabase migration URL, network access, or use Supabase MCP for remote inspection.");
  process.exit(124);
}

if (result.error) {
  console.error(`Supabase CLI command failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
