import { readFile } from "node:fs/promises";
import {
  assertReleaseEvidenceBundle,
  expectedEvidenceReceiptKeys,
  parseEvidenceBundle
} from "./release-evidence.mjs";

export const stagingConfigurationGroups = [
  ["core", ["WEB_URL", "API_URL", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_PROJECT_REF", "SUPABASE_PUBLISHABLE_KEY"]],
  ["wallet", ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED"]],
  ["payments", ["SOLANA_RPC_URL", "PAYMENT_PLATFORM_FEE_WALLET", "HELIUS_WEBHOOK_SECRET", "HELIUS_CLUSTER"]],
  ["vod", ["BUNNY_STREAM_API_KEY", "BUNNY_STREAM_LIBRARY_ID", "BUNNY_STREAM_EMBED_TOKEN_KEY", "BUNNY_STREAM_WEBHOOK_READONLY_KEY", "BUNNY_PROOF_VIDEO_PATH"]],
  ["live", ["LIVEPEER_API_KEY", "LIVEPEER_WEBHOOK_SECRET", "LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY", "LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY", "LIVEPEER_WEBHOOK_ID", "LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID", "LIVEPEER_ADULT_LIVE_ENABLED", "MEDIA_MODERATION_MODE"]],
  ["verification", ["AGE_VERIFICATION_DRIVER", "AGE_VERIFICATION_ALLOW_MOCK_PROVIDER"]],
  ["notifications", ["NOTIFICATION_DEVICE_ENCRYPTION_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "REALTIME_JWT_PRIVATE_JWK", "REALTIME_JWT_KEY_ID", "REALTIME_JWT_ISSUER", "TRANSACTIONAL_EMAIL_PROVIDER", "RESEND_API_KEY", "TRANSACTIONAL_EMAIL_FROM", "TRANSACTIONAL_EMAIL_SMOKE_TO"]],
  ["operations", ["API_RATE_LIMIT_STORE_DRIVER", "API_RATE_LIMIT_REDIS_URL", "OTEL_REQUIRED", "OTEL_EXPORTER_OTLP_ENDPOINT", "RELEASE_MANIFEST_PATH"]],
  ["features", ["SUBSCRIPTIONS_ENABLED"]],
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

export function inspectStagingConfiguration(env = process.env) {
  return stagingConfigurationGroups.map(([name, names]) => {
    const missing = names.filter((key) => !env[key]?.trim());
    const invalid = stagingConfigurationExpectations
      .filter(([group]) => group === name)
      .filter(([, key, expected]) => env[key]?.trim() && env[key]?.trim() !== expected)
      .map(([, key, expected]) => `${key}=${expected}`);
    if (name === "features") {
      for (const key of names) {
        if (env[key]?.trim() && !["true", "false"].includes(env[key].trim())) invalid.push(`${key}=true|false`);
      }
    }
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
