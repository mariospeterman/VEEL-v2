import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  executeStagingProofPlan,
  inspectStagingConfiguration,
  stagingConfigurationGroups,
  stagingProofPlan
} from "./staging-proof-plan.mjs";

describe("strict staging convergence gates", () => {
  it("reports every missing configuration group and rejects unsafe staging values", () => {
    const missing = inspectStagingConfiguration({});
    expect(missing.every((result) => result.status === "CODE_COMPLETE_PROVIDER_BLOCKED")).toBe(true);

    const env = completeDoctorEnv();
    expect(inspectStagingConfiguration(env).every((result) => result.status === "READY")).toBe(true);

    env.LEGAL_DOCUMENTS_APPROVED = "false";
    env.MEDIA_MODERATION_MODE = "disabled_fail_closed";
    env.API_RATE_LIMIT_STORE_DRIVER = "process_memory";
    const unsafe = inspectStagingConfiguration(env);
    expect(unsafe.find((result) => result.name === "legal")?.invalid).toContain("LEGAL_DOCUMENTS_APPROVED=true");
    expect(unsafe.find((result) => result.name === "live")?.invalid).toContain("MEDIA_MODERATION_MODE=launch_approved");
    expect(unsafe.find((result) => result.name === "operations")?.invalid).toContain("API_RATE_LIMIT_STORE_DRIVER=redis");

    env.ENTERPRISE_ENABLED = "maybe";
    expect(inspectStagingConfiguration(env).find((result) => result.name === "features")?.invalid).toContain("ENTERPRISE_ENABLED=true|false");
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
    expect(outcomes.find((outcome) => outcome.name === "enterprise")?.status).toBe("skipped");
    expect(outcomes.find((outcome) => outcome.name === "target-device-accessibility")?.status).toBe("evidence_registered");
    expect(calls.some((call) => call.includes("proof:enterprise"))).toBe(false);
    expect(outcomes.find((outcome) => outcome.name === "bunny-sfw")?.reason).not.toContain("secret-value-not-logged");
  });

  it("requires optional proof commands and release-bound receipts only when their features are enabled", async () => {
    const env = completeProofEnv();
    env.SUBSCRIPTIONS_ENABLED = "true";
    env.ENTERPRISE_ENABLED = "true";
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
    env.ENTERPRISE_STAGING_KYB_EVIDENCE_ID = "kyb";
    env.ENTERPRISE_STAGING_CONTRACT_EVIDENCE_ID = "contract";
    const bundle = JSON.parse(env.STAGING_EVIDENCE_BUNDLE_JSON);
    bundle.receipts.STAGING_SUBSCRIPTIONS_PROOF_ID = "subscription-proof";
    bundle.receipts.STAGING_ENTERPRISE_PROOF_ID = "enterprise-proof";
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
    const doctor = runCli("scripts/staging-doctor.mjs");
    expect(doctor.status).toBe(2);
    expect(doctor.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED core");
    expect(doctor.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED legal");

    const prove = runCli("scripts/staging-prove.mjs");
    expect(prove.status).toBe(2);
    expect(prove.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED release-manifest");
    expect(prove.stdout).toContain("CODE_COMPLETE_PROVIDER_BLOCKED target-device-accessibility");
  });
});

function completeDoctorEnv() {
  const env = Object.fromEntries(
    stagingConfigurationGroups.flatMap(([, keys]) => keys.map((key) => [key, `configured-${key.toLowerCase()}`]))
  );
  return {
    ...env,
    NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED: "true",
    HELIUS_CLUSTER: "devnet",
    LIVEPEER_ADULT_LIVE_ENABLED: "false",
    MEDIA_MODERATION_MODE: "launch_approved",
    AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: "false",
    TRANSACTIONAL_EMAIL_PROVIDER: "resend",
    API_RATE_LIMIT_STORE_DRIVER: "redis",
    OTEL_REQUIRED: "true",
    SUBSCRIPTIONS_ENABLED: "false",
    ENTERPRISE_ENABLED: "false",
    LEGAL_DOCUMENTS_APPROVED: "true"
  };
}

function completeProofEnv() {
  const env = Object.fromEntries(
    stagingProofPlan.flatMap((proof) => proof.required.map((key) => [key, `proof-${key.toLowerCase()}`]))
  );
  env.SUBSCRIPTIONS_ENABLED = "false";
  env.ENTERPRISE_ENABLED = "false";
  env.STAGING_EVIDENCE_BUNDLE_JSON = JSON.stringify({
    schemaVersion: 1,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    receipts: Object.fromEntries([
      "BACKUP_RESTORE_PROOF_ID",
      "STAGING_IDENTITY_WALLET_PROOF_ID",
      "STAGING_VERIFICATION_PROOF_ID",
      "STAGING_PAYMENT_PROOF_ID",
      "STAGING_LIVEPEER_PROOF_ID",
      "STAGING_REALTIME_PUSH_PROOF_ID",
      "STAGING_MODERATION_PROOF_ID",
      "STAGING_STORAGE_BACKUP_PROOF_ID",
      "STAGING_OBSERVABILITY_PROOF_ID",
      "STAGING_DEVICE_QA_PROOF_ID"
    ].map((key) => [key, `proof-${key.toLowerCase()}`]))
  });
  return env;
}

function runCli(path) {
  return spawnSync(process.execPath, [path], {
    cwd: new URL("..", import.meta.url),
    env: { PATH: process.env.PATH },
    encoding: "utf8"
  });
}
