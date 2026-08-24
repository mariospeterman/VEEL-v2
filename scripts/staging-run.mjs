#!/usr/bin/env node
import { spawn } from "node:child_process";
import { assertSafeStagingTarget, redactedStagingSummary } from "./staging-config.mjs";

assertSafeStagingTarget();
for (const capability of redactedStagingSummary().filter((entry) => entry.status !== "READY" && entry.status !== "DISABLED")) {
  console.error(`${capability.status} ${capability.name}`);
}
if (redactedStagingSummary().some((entry) => entry.status === "INVALID" || entry.status === "BLOCKED")) process.exit(2);

if (process.env.STAGING_SKIP_BUILD !== "true") await run("pnpm", ["build"]);

const children = [
  start("api", ["--filter", "@veel/api", "start"]),
  start("worker", ["--filter", "@veel/worker", "start"]),
  start("web", ["--filter", "@veel/web", "start"])
];

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

try {
  await waitForUrl(new URL("/healthz", process.env.API_URL).toString(), 60_000);
  await waitForUrl(new URL("/readyz", process.env.API_URL).toString(), 60_000);
  await waitForUrl(process.env.WEB_URL, 60_000);
  await children.find((child) => child.name === "worker").ready;
  console.log("READY platform web_api_worker database_connected");
  for (const capability of redactedStagingSummary()) console.log(`${capability.status} ${capability.name}`);
  await Promise.race(children.map(({ exit }) => exit));
  if (!closing) throw new Error("A platform process exited unexpectedly");
} finally {
  shutdown("SIGTERM");
}

function start(name, args) {
  const child = spawn("pnpm", args, { env: process.env, stdio: ["inherit", "pipe", "pipe"] });
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 || closing ? resolve({ code, signal }) : reject(new Error(`${name} exited ${code ?? signal}`)));
  });
  const forward = (stream, destination) => stream.on("data", (chunk) => {
    const line = chunk.toString();
    destination.write(`[${name}] ${line}`);
    if (name === "worker" && /worker_ready/.test(line)) readyResolve();
  });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  return { name, child, ready, exit };
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.ok || (response.status >= 300 && response.status < 400)) return;
    } catch {
      // The service may still be starting; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Readiness timed out for ${new URL(url).origin}`);
}

function shutdown(signal) {
  if (closing) return;
  closing = true;
  for (const { child } of children) if (!child.killed) child.kill(signal);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
