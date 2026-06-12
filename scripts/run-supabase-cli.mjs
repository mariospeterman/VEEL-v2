#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const supabaseBin = resolve("node_modules/.bin/supabase");

if (!existsSync(supabaseBin)) {
  console.error("Local Supabase CLI was not found. Run pnpm install first.");
  process.exit(1);
}

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
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error("DATABASE_URL is required.");
      process.exit(1);
    }
    return ["--db-url", databaseUrl];
  }

  return [arg];
});

const result = spawnSync(supabaseBin, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "10"
  },
  timeout: Number(process.env.SUPABASE_CLI_TIMEOUT_MS ?? 45_000)
});

if (result.error?.name === "TimeoutError" || result.signal === "SIGTERM") {
  console.error("Supabase CLI command timed out. Check DATABASE_URL, network access, or use Supabase MCP for remote operations.");
  process.exit(124);
}

if (result.error) {
  console.error(`Supabase CLI command failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
