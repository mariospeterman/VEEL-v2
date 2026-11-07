#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const acceptedAdvisory = {
  id: "GHSA-mrhx-c7xc-m3w5",
  packageName: "zod",
  severity: "high",
  expiresAt: "2026-11-18T00:00:00.000Z"
};

export function validateProductionAuditReport(report, now = new Date()) {
  const errors = [];
  const advisories = report?.advisories;
  if (!advisories || typeof advisories !== "object") {
    return ["pnpm audit report is missing its advisories object"];
  }

  let acceptedAdvisoryPresent = false;
  for (const advisory of Object.values(advisories)) {
    const packageName = advisory?.module_name;
    const id = advisoryId(advisory?.github_advisory_id) ?? advisoryId(advisory?.url);

    const isAccepted =
      packageName === acceptedAdvisory.packageName &&
      advisory?.severity === acceptedAdvisory.severity &&
      id === acceptedAdvisory.id;

    if (!isAccepted) {
      errors.push(`unaccepted production advisory for ${packageName ?? "unknown"}: ${id ?? "unknown"}`);
    } else {
      acceptedAdvisoryPresent = true;
    }
  }

  if (
    acceptedAdvisoryPresent &&
    now.getTime() >= Date.parse(acceptedAdvisory.expiresAt)
  ) {
    errors.push(`${acceptedAdvisory.id} acceptance expired at ${acceptedAdvisory.expiresAt}`);
  }

  return errors;
}

function advisoryId(value) {
  return typeof value === "string" ? value.match(/GHSA-[0-9a-z-]+/iu)?.[0] ?? null : null;
}

function runAudit() {
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, "audit", "--prod", "--json"], { encoding: "utf8" })
    : spawnSync("corepack", ["pnpm", "audit", "--prod", "--json"], { encoding: "utf8" });

  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`pnpm audit did not return JSON: ${result.stderr.trim() || "no diagnostic"}`);
  }

  const errors = validateProductionAuditReport(report);
  if (errors.length > 0) {
    throw new Error(`Production dependency audit failed:\n- ${errors.join("\n- ")}`);
  }

  const accepted = Object.values(report.advisories).some((advisory) =>
    advisory?.module_name === acceptedAdvisory.packageName &&
    advisoryId(advisory?.github_advisory_id) === acceptedAdvisory.id
  );
  console.log(accepted
    ? `Production audit contains only accepted ${acceptedAdvisory.id}; acceptance expires ${acceptedAdvisory.expiresAt}.`
    : "Production dependency audit reports no known vulnerabilities.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAudit();
}
