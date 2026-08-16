#!/usr/bin/env node
import { access } from "node:fs/promises";

const requiredSkeletonFiles = [
  "infra/deploy/README.md",
  "infra/deploy/backup-and-restore.md",
  "infra/deploy/incident-response.md",
  "infra/deploy/legal-launch-gate.md",
  "infra/deploy/rollback-checklist.md",
  "infra/deploy/staging-convergence.md",
  "infra/observability/README.md"
];

const productionRequiredEnv = [
  "API_URL",
  "WEB_URL",
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "SOLANA_RPC_URL",
  "PAYMENT_PLATFORM_FEE_WALLET",
  "HELIUS_WEBHOOK_SECRET",
  "BUNNY_STREAM_API_KEY",
  "BUNNY_STREAM_LIBRARY_ID",
  "BUNNY_STREAM_EMBED_TOKEN_KEY",
  "BUNNY_STREAM_WEBHOOK_READONLY_KEY",
  "LIVEPEER_API_KEY",
  "LIVEPEER_WEBHOOK_SECRET",
  "LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY",
  "LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY",
  "LIVEPEER_WEBHOOK_ID",
  "LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID",
  "NOTIFICATION_DEVICE_ENCRYPTION_KEY"
];

async function assertFile(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing deploy skeleton file: ${path}`);
  }
}

function assertRequiredEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Production readiness is blocked by missing env vars: ${missing.join(", ")}`);
  }
}

function assertProductionProviderSafety() {
  assertRequiredEnv([
    "RELEASE_MANIFEST_PATH",
    "EXPECTED_MANIFEST_DIGEST",
    "STAGING_EVIDENCE_MANIFEST_DIGEST",
    "BACKUP_RESTORE_PROOF_ID",
    "STAGING_IDENTITY_WALLET_PROOF_ID",
    "STAGING_VERIFICATION_PROOF_ID",
    "STAGING_PAYMENT_PROOF_ID",
    "STAGING_LIVEPEER_PROOF_ID",
    "STAGING_REALTIME_PUSH_PROOF_ID",
    "STAGING_MODERATION_PROOF_ID",
    "STAGING_STORAGE_BACKUP_PROOF_ID",
    "STAGING_OBSERVABILITY_PROOF_ID",
    "STAGING_DEVICE_QA_PROOF_ID",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "LEGAL_TERMS_VERSION",
    "LEGAL_PRIVACY_VERSION",
    "LEGAL_CONTACT_EMAIL"
  ]);

  if (process.env.STAGING_EVIDENCE_MANIFEST_DIGEST !== process.env.EXPECTED_MANIFEST_DIGEST) {
    throw new Error("Production readiness is blocked: staging evidence must match the exact approved manifest digest.");
  }

  for (const key of [
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
  ]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,200}$/.test(process.env[key])) {
      throw new Error(`Production readiness is blocked: ${key} must be an opaque redacted evidence reference.`);
    }
  }

  if (process.env.LEGAL_DOCUMENTS_APPROVED !== "true") {
    throw new Error("Production readiness is blocked: final legal documents require recorded counsel/product approval.");
  }

  if (process.env.AGE_VERIFICATION_ALLOW_MOCK_PROVIDER === "true") {
    throw new Error("Production readiness is blocked: AGE_VERIFICATION_ALLOW_MOCK_PROVIDER must not be true.");
  }

  if (!process.env.AGE_VERIFICATION_DRIVER) {
    throw new Error("Production readiness is blocked: AGE_VERIFICATION_DRIVER must select a launch-approved provider.");
  }

  if (process.env.TRANSACTIONAL_EMAIL_PROVIDER === "resend" && !process.env.RESEND_API_KEY) {
    throw new Error("Production readiness is blocked: RESEND_API_KEY is required when Resend email is enabled.");
  }

  if (process.env.ONRAMP_PROVIDER === "coinbase") {
    assertRequiredEnv(["COINBASE_CDP_API_KEY_ID", "COINBASE_CDP_API_KEY_SECRET"]);
  }

  if (process.env.PAYMENT_PLATFORM_TREASURY_WALLET && !process.env.PAYMENT_PLATFORM_FEE_WALLET) {
    throw new Error("Production readiness is blocked: creator_split requires PAYMENT_PLATFORM_FEE_WALLET, not a treasury-only wallet.");
  }

  const paymentAsset = process.env.PAYMENT_DEFAULT_ASSET ?? "SOL";
  if (!["SOL", "USDC"].includes(paymentAsset)) {
    throw new Error("Production readiness is blocked: PAYMENT_DEFAULT_ASSET must be SOL or USDC.");
  }

  if (paymentAsset === "USDC" && !process.env.PAYMENT_USDC_MINT) {
    throw new Error("Production readiness is blocked: PAYMENT_USDC_MINT is required for USDC settlement.");
  }

  const rateLimitStoreDriver = process.env.API_RATE_LIMIT_STORE_DRIVER;
  if (rateLimitStoreDriver !== "redis") {
    throw new Error("Production readiness is blocked: API_RATE_LIMIT_STORE_DRIVER must select the implemented Redis adapter.");
  }

  if (!process.env.API_RATE_LIMIT_REDIS_URL) {
    throw new Error("Production readiness is blocked: API_RATE_LIMIT_REDIS_URL is required when Redis rate limiting is selected.");
  }

  if (process.env.LIVEPEER_ADULT_LIVE_ENABLED === "true") {
    throw new Error("Production readiness is blocked: adult live is not launch-approved and must remain disabled.");
  }

  if (process.env.MEDIA_MODERATION_MODE !== "launch_approved") {
    throw new Error("Production readiness is blocked: MEDIA_MODERATION_MODE must have launch-approved provider evidence.");
  }

  assertProductionSubscriptionSafety();
  assertProductionMcpSafety();
}

function assertProductionSubscriptionSafety() {
  if (process.env.SUBSCRIPTIONS_ENABLED !== "true") {
    return;
  }

  if (process.env.SUBSCRIPTIONS_PROVIDER !== "official_solana_subscription_program") {
    throw new Error("Production readiness is blocked: subscriptions require SUBSCRIPTIONS_PROVIDER=official_solana_subscription_program.");
  }

  if (process.env.SUBSCRIPTIONS_PROVIDER === "mock_subscription_provider_dev_only") {
    throw new Error("Production readiness is blocked: mock subscription provider is not allowed in production.");
  }

  if (process.env.SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION === "false") {
    throw new Error("Production readiness is blocked: subscription on-chain verification must remain enabled.");
  }

  const required = [
    "SUBSCRIPTIONS_SOLANA_PROGRAM_ID",
    "SUBSCRIPTIONS_SOLANA_RPC_URL",
    "SUBSCRIPTIONS_SUPPORTED_MINTS",
    "SUBSCRIPTIONS_DEFAULT_MINT",
    "SUBSCRIPTIONS_COLLECTOR_WALLET",
    "SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY",
    "SUBSCRIPTIONS_MERCHANT_WALLET"
  ];
  assertRequiredEnv(required);

  const supportedMints = process.env.SUBSCRIPTIONS_SUPPORTED_MINTS.split(",")
    .map((mint) => mint.trim())
    .filter(Boolean);

  if (!supportedMints.includes(process.env.SUBSCRIPTIONS_DEFAULT_MINT)) {
    throw new Error("Production readiness is blocked: SUBSCRIPTIONS_DEFAULT_MINT must be listed in SUBSCRIPTIONS_SUPPORTED_MINTS.");
  }

  if (process.env.SUBSCRIPTIONS_DEFAULT_MINT === "SOL" || supportedMints.includes("SOL")) {
    throw new Error("Production readiness is blocked: native SOL recurring subscriptions are not implemented.");
  }

  if (process.env.SUBSCRIPTIONS_SOLANA_PROGRAM_ID !== "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44") {
    throw new Error("Production readiness is blocked: subscriptions must use the canonical official program ID.");
  }

  assertRequiredEnv([
    "SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE",
    "SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE"
  ]);
}

function assertProductionMcpSafety() {
  if (process.env.MCP_ENABLED !== "true") {
    return;
  }

  if (!process.env.MCP_PUBLIC_BASE_URL) {
    throw new Error("Production readiness is blocked: MCP_PUBLIC_BASE_URL is required when MCP is enabled.");
  }

  const mcpPublicUrl = new URL(process.env.MCP_PUBLIC_BASE_URL);
  if (mcpPublicUrl.protocol !== "https:") {
    throw new Error("Production readiness is blocked: MCP_PUBLIC_BASE_URL must use https in production.");
  }

  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(mcpPublicUrl.hostname)) {
    throw new Error("Production readiness is blocked: MCP_PUBLIC_BASE_URL cannot be localhost in production.");
  }

  if (process.env.MCP_AUTH_MODE !== "oauth") {
    throw new Error("Production readiness is blocked: external MCP production connectors require MCP_AUTH_MODE=oauth.");
  }

  if (process.env.MCP_REQUIRE_OAUTH !== "true") {
    throw new Error("Production readiness is blocked: MCP_REQUIRE_OAUTH must remain true in production.");
  }

  if (process.env.MCP_ALLOW_STATIC_TOKENS_DEV === "true") {
    throw new Error("Production readiness is blocked: MCP_ALLOW_STATIC_TOKENS_DEV must not be true.");
  }

  const codeTtl = Number(process.env.MCP_OAUTH_AUTH_CODE_TTL_SECONDS ?? "600");
  if (!Number.isInteger(codeTtl) || codeTtl < 60 || codeTtl > 900) {
    throw new Error("Production readiness is blocked: MCP_OAUTH_AUTH_CODE_TTL_SECONDS must be between 60 and 900.");
  }

  const accessTokenTtl = Number(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? "3600");
  if (!Number.isInteger(accessTokenTtl) || accessTokenTtl < 300 || accessTokenTtl > 86400) {
    throw new Error("Production readiness is blocked: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS must be between 300 and 86400.");
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

  const productionMode = process.env.NODE_ENV === "production" || process.env.DEPLOY_ENV === "production";
  if (productionMode) {
    assertRequiredEnv(productionRequiredEnv);
    assertProductionProviderSafety();
  }

  if (process.env.DEPLOY_ENABLED !== "true") {
    const readinessLevel = productionMode
      ? "Production release preflight passed; no deployment or post-deploy health checks were performed"
      : "Local release preflight passed; no deployment was performed";
    console.log(`${readinessLevel}. Skeleton, rollback, and observability files are present.`);
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

  console.log(
    productionMode
      ? "Production release preflight and configured health checks passed; no deployment was performed."
      : "Staging release preflight and configured health checks passed; no deployment was performed."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
