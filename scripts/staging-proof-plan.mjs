import { readFile } from "node:fs/promises";

export const stagingConfigurationGroups = [
  ["core", ["WEB_URL", "API_URL", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_PROJECT_REF", "SUPABASE_PUBLISHABLE_KEY"]],
  ["wallet", ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED"]],
  ["payments", ["SOLANA_RPC_URL", "PAYMENT_PLATFORM_FEE_WALLET", "HELIUS_WEBHOOK_SECRET", "HELIUS_CLUSTER"]],
  ["vod", ["BUNNY_STREAM_API_KEY", "BUNNY_STREAM_LIBRARY_ID", "BUNNY_STREAM_EMBED_TOKEN_KEY", "BUNNY_STREAM_WEBHOOK_READONLY_KEY", "BUNNY_PROOF_VIDEO_PATH"]],
  ["live", ["LIVEPEER_API_KEY", "LIVEPEER_WEBHOOK_SECRET", "LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY", "LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY", "LIVEPEER_WEBHOOK_ID", "LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID", "LIVEPEER_ADULT_LIVE_ENABLED", "MEDIA_MODERATION_MODE"]],
  ["verification", ["AGE_VERIFICATION_DRIVER", "AGE_VERIFICATION_ALLOW_MOCK_PROVIDER"]],
  ["notifications", ["NOTIFICATION_DEVICE_ENCRYPTION_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "REALTIME_JWT_PRIVATE_JWK", "REALTIME_JWT_KEY_ID", "REALTIME_JWT_ISSUER", "TRANSACTIONAL_EMAIL_PROVIDER", "RESEND_API_KEY", "TRANSACTIONAL_EMAIL_FROM", "TRANSACTIONAL_EMAIL_SMOKE_TO"]],
  ["operations", ["API_RATE_LIMIT_STORE_DRIVER", "API_RATE_LIMIT_REDIS_URL", "OTEL_REQUIRED", "OTEL_EXPORTER_OTLP_ENDPOINT", "RELEASE_MANIFEST_PATH"]],
  ["legal", ["LEGAL_DOCUMENTS_APPROVED", "LEGAL_TERMS_VERSION", "LEGAL_PRIVACY_VERSION", "LEGAL_CONTACT_EMAIL"]]
];

const stagingConfigurationExpectations = [
  ["wallet", "NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED", "true"],
  ["payments", "HELIUS_CLUSTER", "devnet"],
  ["live", "LIVEPEER_ADULT_LIVE_ENABLED", "false"],
  ["live", "MEDIA_MODERATION_MODE", "launch_approved"],
  ["verification", "AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "false"],
  ["notifications", "TRANSACTIONAL_EMAIL_PROVIDER", "resend"],
  ["operations", "API_RATE_LIMIT_STORE_DRIVER", "redis"],
  ["operations", "OTEL_REQUIRED", "true"],
  ["legal", "LEGAL_DOCUMENTS_APPROVED", "true"]
];

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
    required: ["BUNNY_STREAM_API_KEY", "BUNNY_STREAM_LIBRARY_ID", "BUNNY_PROOF_VIDEO_PATH"]
  },
  {
    name: "subscriptions",
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

export function inspectStagingConfiguration(env = process.env) {
  return stagingConfigurationGroups.map(([name, names]) => {
    const missing = names.filter((key) => !env[key]?.trim());
    const invalid = stagingConfigurationExpectations
      .filter(([group]) => group === name)
      .filter(([, key, expected]) => env[key]?.trim() && env[key]?.trim() !== expected)
      .map(([, key, expected]) => `${key}=${expected}`);
    return {
      name,
      status: missing.length === 0 && invalid.length === 0 ? "READY" : "CODE_COMPLETE_PROVIDER_BLOCKED",
      missing,
      invalid
    };
  });
}

export async function executeStagingProofPlan({
  env = process.env,
  runCommand,
  readManifest = readReleaseManifest
}) {
  const outcomes = [];

  for (const proof of stagingProofPlan) {
    const missing = proof.required.filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
      outcomes.push({ name: proof.name, status: "blocked", missing });
      continue;
    }

    if (proof.evidence) {
      try {
        assertOpaqueEvidenceId(env[proof.required[0]], proof.required[0]);
        if (proof.name === "release-bound-evidence") {
          const manifest = await readManifest(env.RELEASE_MANIFEST_PATH);
          if (manifest.manifestDigest !== env.STAGING_EVIDENCE_MANIFEST_DIGEST) {
            throw new Error("evidence_manifest_digest_mismatch");
          }
        }
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
    ["release-bound-evidence", "STAGING_EVIDENCE_MANIFEST_DIGEST"],
    ["identity-wallet", "STAGING_IDENTITY_WALLET_PROOF_ID"],
    ["verification", "STAGING_VERIFICATION_PROOF_ID"],
    ["payments", "STAGING_PAYMENT_PROOF_ID"],
    ["livepeer", "STAGING_LIVEPEER_PROOF_ID"],
    ["realtime-push", "STAGING_REALTIME_PUSH_PROOF_ID"],
    ["moderation", "STAGING_MODERATION_PROOF_ID"],
    ["database-backup-evidence", "BACKUP_RESTORE_PROOF_ID"],
    ["storage-backup-evidence", "STAGING_STORAGE_BACKUP_PROOF_ID"],
    ["observability-alerting", "STAGING_OBSERVABILITY_PROOF_ID"],
    ["target-device-accessibility", "STAGING_DEVICE_QA_PROOF_ID"]
  ].map(([name, key]) => ({ name, evidence: true, required: [key] }));
}

async function readReleaseManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertOpaqueEvidenceId(value, key) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,200}$/.test(value)) {
    throw new Error(`${key.toLowerCase()}_must_be_an_opaque_redacted_reference`);
  }
}

function safeReason(error) {
  if (!(error instanceof Error)) return "unknown_failure";
  return error.message.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160);
}
