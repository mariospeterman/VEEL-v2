#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const dbUrl = process.env.SUPABASE_DIRECT_DB_URL ?? process.env.DATABASE_URL;
if (!dbUrl) throw new Error("SUPABASE_DIRECT_DB_URL or DATABASE_URL is required");
const output = path.resolve(process.env.BACKUP_OUTPUT_DIR ?? `backups/${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(output, { recursive: true, mode: 0o700 });

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "supabase", "db", "dump", "--db-url", dbUrl, ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Supabase backup exited ${code}`)));
  });
}

await run(["--role-only", "--file", path.join(output, "roles.sql")]);
await run(["--file", path.join(output, "schema.sql")]);
await run(["--data-only", "--use-copy", "--file", path.join(output, "data.sql")]);
console.log(`Created logical database backup in ${output}. Supabase Storage objects require a separate provider-level copy.`);
