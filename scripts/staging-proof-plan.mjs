import { readFile } from "node:fs/promises";
import {
  assertReleaseEvidenceBundle,
  expectedEvidenceReceiptKeys,
  parseEvidenceBundle
} from "./release-evidence.mjs";

export const stagingProofPlan = [
  {
    name: "release-manifest",
    command: ["node", "scripts/verify-release-manifest.mjs"],
    required: ["RELEASE_MANIFEST_PATH"]
  },
  {
    name: "synthetic",
    command: ["node", "scripts/synthetic-smoke.mjs"],
    required: ["WEB_URL", "API_URL"]
  },
  {
    name: "bunny-sfw",
    command: ["pnpm", "proof:bunny-sfw"],
    required: [
      "BUNNY_STREAM_API_KEY",
      "BUNNY_STREAM_LIBRARY_ID",
      "BUNNY_SHIELD_API_KEY",
      "BUNNY_SHIELD_ZONE_ID",
      "BUNNY_SHIELD_UPLOAD_COVERAGE",
      "BUNNY_PROOF_VIDEO_PATH"
    ]
  },
  {
    name: "subscriptions",
    enabledWhen: (env) => env.SUBSCRIPTIONS_ENABLED === "true",
    command: ["pnpm", "proof:subscriptions"],
    required: [
      "DATABASE_URL",
      "SUBSCRIPTIONS_SOLANA_RPC_URL",
      "SUBSCRIPTIONS_SOLANA_PROGRAM_ID",
      "SUBSCRIPTIONS_DEFAULT_MINT",
      "SUBSCRIPTIONS_COLLECTOR_WALLET",
      "SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY",
      "SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE",
      "SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE"
    ]
  },
  {
    name: "enterprise",
    command: ["pnpm", "proof:enterprise"],
    required: [
      "API_URL",
      "ENTERPRISE_STAGING_SESSION_COOKIE",
      "ENTERPRISE_STAGING_ORGANIZATION_ID",
      "ENTERPRISE_STAGING_RELATIONSHIP_ID",
      "ENTERPRISE_STAGING_KYB_EVIDENCE_ID",
      "ENTERPRISE_STAGING_CONTRACT_EVIDENCE_ID"
    ]
  },
  {
    name: "transactional-email",
    command: ["pnpm", "--filter", "@veel/worker", "email:smoke"],
    required: ["TRANSACTIONAL_EMAIL_PROVIDER", "RESEND_API_KEY", "TRANSACTIONAL_EMAIL_FROM", "TRANSACTIONAL_EMAIL_SMOKE_TO", "WEB_URL"]
  },
  {
    name: "database-backup-restore",
    command: ["pnpm", "db:restore:prove"],
    required: ["BACKUP_INPUT_DIR", "RESTORE_TARGET_DB_URL", "RESTORE_PROOF_ACK"]
  },
  {
    name: "storage-backup-restore",
    command: ["pnpm", "storage:restore:prove"],
    required: ["STORAGE_BACKUP_SOURCE_DIR", "STORAGE_RESTORE_TARGET_DIR", "STORAGE_RESTORE_PROOF_ACK"]
  },
  ...evidenceProofs()
];

export async function executeStagingProofPlan({
  env = process.env,
  runCommand,
  readManifest = readReleaseManifest,
  readEvidenceBundle = parseEvidenceBundle
}) {
  const outcomes = [];

  for (const proof of stagingProofPlan) {
    if (proof.enabledWhen && !proof.enabledWhen(env)) {
      outcomes.push({ name: proof.name, status: "skipped", reason: "feature_disabled" });
      continue;
    }

    const missing = proof.required.filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
      outcomes.push({ name: proof.name, status: "blocked", missing });
      continue;
    }

    if (proof.evidence) {
      try {
        const manifest = await readManifest(env.RELEASE_MANIFEST_PATH);
        const bundle = await readEvidenceBundle(env.STAGING_EVIDENCE_BUNDLE_JSON);
        assertReleaseEvidenceBundle(bundle, manifest.manifestDigest, expectedEvidenceReceiptKeys(env));
        outcomes.push({ name: proof.name, status: "evidence_registered" });
      } catch (error) {
        outcomes.push({ name: proof.name, status: "failed", reason: safeReason(error) });
      }
      continue;
    }

    try {
      await runCommand(proof.command[0], proof.command.slice(1));
      outcomes.push({ name: proof.name, status: "passed" });
    } catch {
      outcomes.push({ name: proof.name, status: "failed", reason: "command_failed" });
    }
  }

  return outcomes;
}

function evidenceProofs() {
  return [
    { name: "release-bound-evidence" },
    { name: "identity-wallet" },
    { name: "verification" },
    { name: "payments" },
    { name: "livepeer" },
    { name: "realtime-push" },
    { name: "moderation" },
    { name: "database-backup-evidence" },
    { name: "storage-backup-evidence" },
    { name: "observability-alerting" },
    { name: "target-device-accessibility" },
    { name: "subscriptions-evidence", enabledWhen: (env) => env.SUBSCRIPTIONS_ENABLED === "true" },
    { name: "enterprise-evidence" }
  ].map((proof) => ({ ...proof, evidence: true, required: ["STAGING_EVIDENCE_BUNDLE_JSON"] }));
}

async function readReleaseManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function safeReason(error) {
  if (!(error instanceof Error)) return "unknown_failure";
  return error.message.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
}
