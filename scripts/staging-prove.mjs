#!/usr/bin/env node
import { spawn } from "node:child_process";

const proofs = [
  { name: "release-manifest", command: ["node", "scripts/verify-release-manifest.mjs"], required: ["RELEASE_MANIFEST_PATH"] },
  { name: "synthetic", command: ["node", "scripts/synthetic-smoke.mjs"], required: ["WEB_URL", "API_URL"] },
  { name: "bunny-sfw", command: ["pnpm", "proof:bunny-sfw"], required: ["BUNNY_STREAM_API_KEY", "BUNNY_STREAM_LIBRARY_ID", "BUNNY_STREAM_WEBHOOK_READONLY_KEY"] },
  { name: "subscriptions", command: ["pnpm", "proof:subscriptions"], required: ["SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE", "SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE"] },
  { name: "enterprise", command: ["pnpm", "proof:enterprise"], required: ["ENTERPRISE_STAGING_SESSION_COOKIE", "ENTERPRISE_STAGING_ORGANIZATION_ID", "ENTERPRISE_STAGING_RELATIONSHIP_ID"] }
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

const blocked = [];
for (const proof of proofs) {
  const missing = proof.required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    blocked.push(proof.name);
    console.log(`CODE_COMPLETE_PROVIDER_BLOCKED ${proof.name} missing=${missing.join(",")}`);
    continue;
  }
  await run(proof.command[0], proof.command.slice(1));
  console.log(`PROOF_PASSED ${proof.name}`);
}

if (process.env.STAGING_REQUIRE_COMPLETE === "true" && blocked.length > 0) {
  throw new Error(`Required staging proof is blocked: ${blocked.join(", ")}`);
}
