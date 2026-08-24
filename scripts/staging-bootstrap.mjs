#!/usr/bin/env node
import { spawn } from "node:child_process";
import { assertSafeStagingTarget } from "./staging-config.mjs";

assertSafeStagingTarget();
await run("pnpm", ["staging:doctor", "--json"]);
await run("pnpm", ["staging:cloud:link"]);
await run("pnpm", ["staging:migrations:plan"]);
console.log("READY staging_bootstrap target_verified migration_plan_clean");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
