#!/usr/bin/env node
import { access } from "node:fs/promises";

const requiredSkeletonFiles = [
  "infra/deploy/README.md",
  "infra/deploy/rollback-checklist.md",
  "infra/observability/README.md"
];

async function assertFile(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing deploy skeleton file: ${path}`);
  }
}

async function fetchJson(url, expectedStatus) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned ${response.status}, expected ${expectedStatus}`);
  }

  return response.json();
}

async function main() {
  for (const file of requiredSkeletonFiles) {
    await assertFile(file);
  }

  if (process.env.DEPLOY_ENABLED !== "true") {
    console.log("Deploy is disabled. Skeleton, rollback, and observability files are present.");
    return;
  }

  const healthUrl = process.env.API_HEALTH_URL;
  const readyUrl = process.env.API_READY_URL;

  if (!healthUrl || !readyUrl) {
    throw new Error("DEPLOY_ENABLED=true requires API_HEALTH_URL and API_READY_URL");
  }

  const health = await fetchJson(healthUrl, 200);
  if (health.status !== "ok") {
    throw new Error(`${healthUrl} returned health status ${health.status}`);
  }

  const readiness = await fetchJson(readyUrl, 200);
  if (readiness.status !== "ok") {
    throw new Error(`${readyUrl} returned readiness status ${readiness.status}`);
  }

  console.log("Deploy readiness health checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
