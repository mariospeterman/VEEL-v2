import { spawn } from "node:child_process";

const filters = ["--filter", "@veel/api", "--filter", "@veel/web"];
if (process.env.VEEL_DEV_FULL === "true") filters.push("--filter", "@veel/worker");

const development = spawn(
  "pnpm",
  ["--parallel", ...filters, "dev"],
  {
    env: process.env,
    stdio: "inherit"
  }
);

development.once("error", (error) => {
  console.error(`Could not start local development: ${error.message}`);
  process.exitCode = 1;
});

development.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
