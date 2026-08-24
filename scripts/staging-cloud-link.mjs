#!/usr/bin/env node
import { spawn } from "node:child_process";
import { assertSafeStagingTarget } from "./staging-config.mjs";

assertSafeStagingTarget();

if (!process.env.SUPABASE_PROJECT_REF) throw new Error("SUPABASE_PROJECT_REF is required");
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is required");

await run("pnpm", ["supabase:version"]);
await run("node", ["--env-file-if-exists=.env.staging", "scripts/run-supabase-cli.mjs", "link", "--project-ref-env"]);
await run("node", ["--env-file-if-exists=.env.staging", "scripts/run-supabase-cli.mjs", "migration", "list", "--db-url-env"]);
await run("node", ["--env-file-if-exists=.env.staging", "scripts/run-supabase-cli.mjs", "db", "advisors", "--db-url-env", "--type", "all", "--level", "warn", "--fail-on", "none"]);
console.log("READY cloud_link target_verified history_and_advisors_read_only");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
