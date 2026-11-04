import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  executeStagingProofPlan,
  stagingProofPlan
} from "./staging-proof-plan.mjs";
import {
  inspectStagingEnvironment,
  redactedStagingSummary,
  stagingCapabilities
} from "./staging-config.mjs";
import {
  deriveAcceptanceOverall,
  deriveJourneyResults
} from "./staging-acceptance-status.mjs";

describe("strict staging convergence gates", () => {
  it("documents every supported payment guardrail and verification provider key", () => {
    const examples = [
      readFileSync(new URL("../.env.example", import.meta.url), "utf8"),
      readFileSync(new URL("../apps/api/.env.example", import.meta.url), "utf8"),
      readFileSync(new URL("../.env.staging.example", import.meta.url), "utf8")
    ];
    const paymentControls = [
      "PAYMENT_MIN_CONTENT_UNLOCK_SOL_LAMPORTS",
      "PAYMENT_MIN_CONTENT_UNLOCK_USDC_ATOMIC",
      "PAYMENT_MIN_PAID_MESSAGE_SOL_LAMPORTS",
      "PAYMENT_MIN_PAID_MESSAGE_USDC_ATOMIC",
      "PAYMENT_MIN_LIVE_PASS_SOL_LAMPORTS",
      "PAYMENT_MIN_LIVE_PASS_USDC_ATOMIC",
      "PAYMENT_MIN_EVENT_ACCESS_PASS_SOL_LAMPORTS",
      "PAYMENT_MIN_EVENT_ACCESS_PASS_USDC_ATOMIC",
      "PAYMENT_QUOTE_TTL_SECONDS"
    ];
    for (const example of examples) {
      for (const name of paymentControls) expect(example).toMatch(new RegExp(`^${name}=`, "m"));
    }

    const staging = examples[2];
    const verificationProviderKeys = [
      "DIDIT_API_KEY", "DIDIT_WEBHOOK_SECRET", "DIDIT_AGE_WORKFLOW_ID",
      "DIDIT_ADULT_PUBLISHER_WORKFLOW_ID", "DIDIT_KYC_WORKFLOW_ID", "DIDIT_KYB_WORKFLOW_ID",
      "DIDIT_API_BASE_URL", "YOTI_SDK_ID", "YOTI_API_TOKEN", "YOTI_NOTIFICATION_KEY_PATH",
      "YOTI_API_BASE_URL", "YOTI_LAUNCH_BASE_URL", "SUMSUB_APP_TOKEN", "SUMSUB_SECRET_KEY",
      "SUMSUB_WEBHOOK_SECRET", "SUMSUB_LEVEL_NAME", "SUMSUB_CREATOR_KYC_LEVEL_NAME",
      "SUMSUB_ORG_KYB_LEVEL_NAME", "SUMSUB_API_BASE_URL", "PERSONA_API_KEY",
      "PERSONA_WEBHOOK_SECRET", "PERSONA_TEMPLATE_ID", "PERSONA_CREATOR_KYC_TEMPLATE_ID",
      "PERSONA_ORG_KYB_TEMPLATE_ID", "PERSONA_API_BASE_URL", "VERIFF_API_KEY",
      "VERIFF_SHARED_SECRET", "VERIFF_API_BASE_URL"
    ];
    for (const name of verificationProviderKeys) expect(staging).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("keeps the example environment and staging workflow aligned with the canonical registry", () => {
    const example = readFileSync(new URL("../.env.staging.example", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");
    expect(example).not.toMatch(/^[A-Z0-9_]+= #/m);
    const variables = [...new Set(stagingCapabilities.flatMap((capability) => capability.variables))];
    for (const variable of variables) {
      expect(example).toMatch(new RegExp(`^${variable.name}=`, "m"));
    }
    const requiredWorkflowVariables = new Set(stagingCapabilities.flatMap((capability) =>
      capability.variables.filter((variable) => capability.required || variable.required).map((variable) => variable.name)
    ));
    requiredWorkflowVariables.delete("RELEASE_MANIFEST_PATH");
    for (const name of requiredWorkflowVariables) expect(workflow).toContain(`${name}:`);
  });

  it("normalizes legacy blank entries and keeps the private staging file owner-only", () => {
    const directory = mkdtempSync(join(tmpdir(), "wevid-staging-init-"));
    try {
      const example = "DEPLOY_ENV=staging # public|required\nSUPABASE_URL= # public|required\n";
      const target = `${example}PRESERVED_VALUE=configured\n`;
      writeFileSync(join(directory, ".env.staging.example"), example);
      writeFileSync(join(directory, ".env.staging"), target, { mode: 0o644 });

      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./staging-init.mjs", import.meta.url))], {
        cwd: directory,
        encoding: "utf8"
      });

      expect(result.status).toBe(0);
      expect(readFileSync(join(directory, ".env.staging"), "utf8")).toContain('SUPABASE_URL="" # public|required');
      expect(readFileSync(join(directory, ".env.staging"), "utf8")).toContain("PRESERVED_VALUE=configured");
      expect(statSync(join(directory, ".env.staging")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports every missing configuration group and rejects unsafe staging values", () => {
    const missing = inspectStagingEnvironment({ DEPLOY_ENV: "staging", NODE_ENV: "production" });
    expect(missing.some((result) => result.status === "BLOCKED")).toBe(true);
    expect(missing.find((result) => result.name === "subscriptions")?.status).toBe("BLOCKED");
    expect(missing.find((result) => result.name === "mcp")?.status).toBe("BLOCKED");

    const env = completeDoctorEnv();
    expect(inspectStagingEnvironment(env).every((result) => ["READY", "DISABLED"].includes(result.status))).toBe(true);

    env.LEGAL_DOCUMENTS_APPROVED = "false";
    env.MEDIA_MODERATION_MODE = "disabled_fail_closed";
    env.API_RATE_LIMIT_STORE_DRIVER = "process_memory";
    const unsafe = inspectStagingEnvironment(env);
    expect(unsafe.find((result) => result.name === "legal_release")?.missing).toContain("LEGAL_DOCUMENTS_APPROVED=true");
    expect(unsafe.find((result) => result.name === "moderation")?.invalid).toContain("MEDIA_MODERATION_MODE=shadow|enforced|launch_approved");
    expect(unsafe.find((result) => result.name === "rate_limiting")?.invalid).toContain("API_RATE_LIMIT_STORE_DRIVER=redis");

    env.SUBSCRIPTIONS_ENABLED = "maybe";
    expect(inspectStagingEnvironment(env).find((result) => result.name === "subscriptions")?.status).toBe("INVALID");

    env.SUPABASE_PROJECT_REF = env.SUPABASE_PRODUCTION_PROJECT_REF;
    expect(inspectStagingEnvironment(env).find((result) => result.name === "core")?.invalid).toContain("production_project_ref");
    expect(JSON.stringify(redactedStagingSummary(env))).not.toContain(env.DATABASE_URL);
  });

  it("runs independent configured proofs after one provider command fails", async () => {
    const env = completeProofEnv();
    const calls = [];
    const runCommand = vi.fn(async (command, args) => {
      calls.push([command, ...args].join(" "));
      if (args.includes("proof:bunny-sfw")) throw new Error("provider unavailable with secret-value-not-logged");
    });

    const outcomes = await executeStagingProofPlan({
      env,
      runCommand,
      readManifest: async () => ({ manifestDigest: `sha256:${"a".repeat(64)}` })
    });

    expect(outcomes.find((outcome) => outcome.name === "bunny-sfw")?.status).toBe("failed");
    expect(outcomes.find((outcome) => outcome.name === "subscriptions")?.status).toBe("skipped");
    expect(outcomes.find((outcome) => outcome.name === "enterprise")?.status).toBe("passed");
    expect(outcomes.find((outcome) => outcome.name === "target-device-accessibility")?.status).toBe("evidence_registered");
    expect(calls.some((call) => call.includes("proof:enterprise"))).toBe(true);
    expect(outcomes.find((outcome) => outcome.name === "bunny-sfw")?.reason).not.toContain("secret-value-not-logged");
  });

  it("requires subscription proof commands and release-bound receipts only when subscriptions are enabled", async () => {
    const env = completeProofEnv();
    env.SUBSCRIPTIONS_ENABLED = "true";
    env.SUBSCRIPTIONS_SOLANA_RPC_URL = "https://rpc.example.test";
    env.SUBSCRIPTIONS_SOLANA_PROGRAM_ID = "program";
    env.SUBSCRIPTIONS_DEFAULT_MINT = "mint";
    env.SUBSCRIPTIONS_COLLECTOR_WALLET = "wallet";
    env.SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY = "private";
    env.SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE = "authorization";
    env.SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE = "collection";
    env.ENTERPRISE_STAGING_SESSION_COOKIE = "cookie";
    env.ENTERPRISE_STAGING_ORGANIZATION_ID = "organization";
    env.ENTERPRISE_STAGING_RELATIONSHIP_ID = "relationship";
    const bundle = JSON.parse(env.STAGING_EVIDENCE_BUNDLE_JSON);
    bundle.receipts.STAGING_SUBSCRIPTIONS_PROOF_ID = "subscription-proof";
    env.STAGING_EVIDENCE_BUNDLE_JSON = JSON.stringify(bundle);

    const calls = [];
    const outcomes = await executeStagingProofPlan({
      env,
      runCommand: async (command, args) => calls.push([command, ...args].join(" ")),
      readManifest: async () => ({ manifestDigest: bundle.manifestDigest })
    });

    expect(outcomes.find((outcome) => outcome.name === "subscriptions")?.status).toBe("passed");
    expect(outcomes.find((outcome) => outcome.name === "enterprise")?.status).toBe("passed");
    expect(outcomes.find((outcome) => outcome.name === "subscriptions-evidence")?.status).toBe("evidence_registered");
    expect(outcomes.find((outcome) => outcome.name === "enterprise-evidence")?.status).toBe("evidence_registered");
    expect(calls.some((call) => call.includes("proof:subscriptions"))).toBe(true);
    expect(calls.some((call) => call.includes("proof:enterprise"))).toBe(true);
  });

  it("rejects evidence that is not bound to the exact release manifest", async () => {
    const env = completeProofEnv();
    const bundle = JSON.parse(env.STAGING_EVIDENCE_BUNDLE_JSON);
    bundle.manifestDigest = `sha256:${"a".repeat(64)}`;
    env.STAGING_EVIDENCE_BUNDLE_JSON = JSON.stringify(bundle);
    const outcomes = await executeStagingProofPlan({
      env,
      runCommand: async () => {},
      readManifest: async () => ({ manifestDigest: `sha256:${"b".repeat(64)}` })
    });

    expect(outcomes.find((outcome) => outcome.name === "release-bound-evidence")).toMatchObject({
      status: "failed",
      reason: "evidence_manifest_digest_mismatch"
    });
  });

  it("returns non-zero from both CLIs when required launch evidence is absent", () => {
    const doctor = runCli("scripts/staging-doctor.mjs", { DEPLOY_ENV: "staging", NODE_ENV: "production" });
    expect(doctor.status).toBe(2);
    expect(doctor.stdout).toContain("BLOCKED core");
    expect(doctor.stdout).toContain("BLOCKED legal_release");

    const prove = runCli("scripts/staging-prove.mjs");
    expect(prove.status).toBe(2);
    expect(prove.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED release-manifest");
    expect(prove.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED target-device-accessibility");
  });

  it("derives journeys from exact-release outcomes and never promotes a partial matrix", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const sourceSha = "1".repeat(40);
    const journeyDefinitions = [
      {
        id: "auth.continue_to_wevid",
        requiredCapabilities: ["wallet"],
        requiredProofs: ["identity-wallet", "target-device-accessibility"],
        blockerClass: "wallet_provider_credentials"
      },
      {
        id: "admin.permission_rbac",
        requiredCapabilities: ["core"],
        requiredProofs: ["target-device-accessibility"],
        blockerClass: "admin_rbac_journey_not_proven"
      },
      {
        id: "mcp.optional_bridge",
        requiredCapabilities: ["core", "mcp"],
        requiredProofs: ["target-device-accessibility"],
        optionalCapability: "mcp",
        blockerClass: "public_https_and_client_configuration"
      }
    ];
    const capabilityStatus = new Map([
      ["core", "READY"],
      ["wallet", "READY"],
      ["mcp", "DISABLED"]
    ]);
    const proofOutcomes = [
      { name: "release-manifest", status: "passed" },
      { name: "synthetic", status: "passed" },
      { name: "identity-wallet", status: "evidence_registered" },
      { name: "target-device-accessibility", status: "evidence_registered" }
    ];
    const configuration = [
      { name: "core", status: "READY" },
      { name: "wallet", status: "READY" },
      { name: "mcp", status: "DISABLED" }
    ];
    const commands = [
      { name: "cloud-link", status: "PASS" },
      { name: "release-manifest-verification", status: "PASS" },
      { name: "staging-browser", status: "PASS" }
    ];
    const releaseManifest = { manifestDigest: digest, sourceSha };
    const recorded = (status, evidenceId, overrides = {}) => ({
      status,
      evidenceId,
      manifestDigest: digest,
      releaseSha: sourceSha,
      executedAt: "2026-11-04T12:00:00.000Z",
      ...overrides
    });
    const derive = (journeyOutcomes) => deriveJourneyResults({
      journeys: journeyDefinitions,
      capabilityStatus,
      proofOutcomes,
      evidenceBundle: { manifestDigest: digest, journeyOutcomes },
      releaseManifest
    });
    const overall = (journeys) => deriveAcceptanceOverall({
      configuration,
      commands,
      proofs: proofOutcomes,
      journeys
    });

    const nothingRan = derive({});
    expect(nothingRan).toEqual([
      expect.objectContaining({ id: "auth.continue_to_wevid", status: "NOT_RUN" }),
      expect.objectContaining({ id: "admin.permission_rbac", status: "NOT_RUN" }),
      expect.objectContaining({ id: "mcp.optional_bridge", status: "DEFERRED" })
    ]);
    expect(overall(nothingRan)).toBe("INCOMPLETE");

    const failedAdmin = derive({
      "auth.continue_to_wevid": recorded("PASS", "proof-auth"),
      "admin.permission_rbac": recorded("FAIL", undefined, { reason: "admin_journey_failed" })
    });
    expect(failedAdmin.find((journey) => journey.id === "admin.permission_rbac")?.status).toBe("FAIL");
    expect(overall(failedAdmin)).toBe("FAIL");

    const staleWallet = derive({
      "auth.continue_to_wevid": recorded("PASS", "proof-auth", {
        manifestDigest: `sha256:${"b".repeat(64)}`
      })
    });
    expect(staleWallet.find((journey) => journey.id === "auth.continue_to_wevid")).toMatchObject({
      status: "FAIL",
      reason: "journey_evidence_manifest_digest_mismatch"
    });

    const wrongReleaseWallet = derive({
      "auth.continue_to_wevid": recorded("PASS", "proof-auth", { releaseSha: "2".repeat(40) })
    });
    expect(wrongReleaseWallet.find((journey) => journey.id === "auth.continue_to_wevid")).toMatchObject({
      status: "FAIL",
      reason: "journey_evidence_release_sha_mismatch"
    });

    const walletOnly = derive({
      "auth.continue_to_wevid": recorded("PASS", "proof-auth")
    });
    expect(walletOnly.find((journey) => journey.id === "auth.continue_to_wevid")?.status).toBe("PASS");
    expect(walletOnly.find((journey) => journey.id === "admin.permission_rbac")?.status).toBe("NOT_RUN");
    expect(overall(walletOnly)).toBe("INCOMPLETE");

    const complete = derive({
      "auth.continue_to_wevid": recorded("PASS", "proof-auth"),
      "admin.permission_rbac": recorded("PASS", "proof-admin")
    });
    expect(complete.map((journey) => journey.status)).toEqual(["PASS", "PASS", "DEFERRED"]);
    expect(overall(complete)).toBe("PASS");
  });
});

function completeDoctorEnv() {
  const env = Object.fromEntries(
    stagingCapabilities.flatMap((capability) => capability.variables.map((entry) => [entry.name, `configured-${entry.name.toLowerCase()}`]))
  );
  return {
    ...env,
    NODE_ENV: "production",
    DEPLOY_ENV: "staging",
    WEB_URL: "https://web.staging.example.test",
    API_URL: "https://api.staging.example.test",
    NEXT_PUBLIC_APP_URL: "https://web.staging.example.test",
    NEXT_PUBLIC_API_BASE_URL: "https://api.staging.example.test",
    SUPABASE_URL: "https://stage-ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://stage-ref.supabase.co",
    SUPABASE_PROJECT_REF: "stage-ref",
    SUPABASE_PRODUCTION_PROJECT_REF: "production-ref",
    DATABASE_URL: "postgresql://postgres.stage-ref:secret@aws-0-eu.pooler.supabase.com:6543/postgres",
    SUPABASE_DIRECT_DB_URL: "postgresql://postgres.stage-ref:secret@aws-0-eu.pooler.supabase.com:5432/postgres",
    NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED: "true",
    NEXT_PUBLIC_SOLANA_CHAIN: "solana:devnet",
    SOLANA_CLUSTER: "devnet",
    SOLANA_NETWORK: "solana:devnet",
    HELIUS_CLUSTER: "devnet",
    LIVEPEER_ADULT_LIVE_ENABLED: "false",
    MEDIA_MODERATION_MODE: "shadow",
    AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: "false",
    TRANSACTIONAL_EMAIL_PROVIDER: "resend",
    API_RATE_LIMIT_STORE_DRIVER: "redis",
    OTEL_REQUIRED: "true",
    OTEL_SDK_DISABLED: "false",
    SUBSCRIPTIONS_ENABLED: "false",
    MCP_ENABLED: "false",
    LEGAL_DOCUMENTS_APPROVED: "true"
  };
}

function completeProofEnv() {
  const env = Object.fromEntries(
    stagingProofPlan.flatMap((proof) => proof.required.map((key) => [key, `proof-${key.toLowerCase()}`]))
  );
  env.SUBSCRIPTIONS_ENABLED = "false";
  env.STAGING_EVIDENCE_BUNDLE_JSON = JSON.stringify({
    schemaVersion: 1,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    receipts: Object.fromEntries([
      "BACKUP_RESTORE_PROOF_ID",
      "STAGING_IDENTITY_WALLET_PROOF_ID",
      "STAGING_VERIFICATION_PROOF_ID",
      "STAGING_PAYMENT_PROOF_ID",
      "STAGING_LIVEPEER_PROOF_ID",
      "STAGING_MEDIA_SAFETY_PROOF_ID",
      "STAGING_REALTIME_PUSH_PROOF_ID",
      "STAGING_MODERATION_PROOF_ID",
      "STAGING_STORAGE_BACKUP_PROOF_ID",
      "STAGING_OBSERVABILITY_PROOF_ID",
      "STAGING_DEVICE_QA_PROOF_ID",
      "STAGING_ENTERPRISE_PROOF_ID"
    ].map((key) => [key, `proof-${key.toLowerCase()}`]))
  });
  return env;
}

function runCli(path, extraEnv = {}) {
  return spawnSync(process.execPath, [path], {
    cwd: new URL("..", import.meta.url),
    env: { PATH: process.env.PATH, ...extraEnv },
    encoding: "utf8"
  });
}
