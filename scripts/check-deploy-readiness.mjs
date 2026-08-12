#!/usr/bin/env node
import { access } from "node:fs/promises";

const requiredSkeletonFiles = [
  "infra/deploy/README.md",
  "infra/deploy/rollback-checklist.md",
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

  if (process.env.PAYMENT_DEFAULT_ASSET && process.env.PAYMENT_DEFAULT_ASSET !== "SOL") {
    throw new Error("Production readiness is blocked: only native SOL creator split settlement is implemented.");
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
    const readinessLevel = productionMode ? "production blocked: deploy health checks disabled" : "local/dev ready";
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

  console.log(productionMode ? "Production readiness preflight passed." : "Staging readiness health checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
