import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";

export const stagingStates = ["READY", "DISABLED", "BLOCKED", "INVALID"];

export const stagingCapabilities = [
  capability("core", true, [
    variable("NODE_ENV", "public", true),
    variable("DEPLOY_ENV", "public", true),
    variable("WEB_URL", "public", true),
    variable("API_URL", "public", true),
    variable("NEXT_PUBLIC_APP_URL", "public", true),
    variable("NEXT_PUBLIC_API_BASE_URL", "public", true),
    variable("APP_VERSION", "public", true),
    variable("GIT_SHA", "public", true),
    variable("RELEASE_MANIFEST_PATH", "public", true),
    variable("STAGING_FIXTURE_NAMESPACE", "public", true)
  ]),
  capability("supabase_cloud", true, [
    variable("DATABASE_URL", "secret", true),
    variable("SUPABASE_URL", "public", true),
    variable("SUPABASE_PROJECT_REF", "public", true),
    variable("SUPABASE_PRODUCTION_PROJECT_REF", "secret", true),
    variable("SUPABASE_PUBLISHABLE_KEY", "public", true),
    variable("SUPABASE_SECRET_KEY", "secret", true),
    variable("SUPABASE_DIRECT_DB_URL", "secret", true),
    variable("SUPABASE_ACCESS_TOKEN", "secret", true),
    variable("NEXT_PUBLIC_SUPABASE_URL", "public", true),
    variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public", true)
  ]),
  capability("rate_limiting", true, [
    variable("API_RATE_LIMIT_STORE_DRIVER", "public", true),
    variable("API_RATE_LIMIT_REDIS_URL", "secret", true)
  ]),
  capability("wallet", true, [
    variable("NEXT_PUBLIC_PRIVY_APP_ID", "public", true),
    variable("PRIVY_APP_SECRET", "secret", true),
    variable("PRIVY_JWKS_ENDPOINT", "public", true),
    variable("NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED", "public", true),
    variable("NEXT_PUBLIC_SOLANA_CHAIN", "public", true),
    variable("NEXT_PUBLIC_SOLANA_RPC_URL", "public", true)
  ]),
  capability("payments", true, [
    variable("SOLANA_CLUSTER", "public", true),
    variable("SOLANA_NETWORK", "public", true),
    variable("SOLANA_RPC_URL", "secret", true),
    variable("PAYMENT_PLATFORM_FEE_WALLET", "public", true),
    variable("HELIUS_WEBHOOK_SECRET", "secret", true),
    variable("HELIUS_CLUSTER", "public", true)
  ]),
  capability("bunny", true, [
    variable("BUNNY_STREAM_API_KEY", "secret", true),
    variable("BUNNY_STREAM_LIBRARY_ID", "public", true),
    variable("BUNNY_STREAM_EMBED_TOKEN_KEY", "secret", true),
    variable("BUNNY_STREAM_WEBHOOK_READONLY_KEY", "secret", true),
    variable("BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED", "public", true),
    variable("BUNNY_STORAGE_ACCESS_KEY", "secret", true),
    variable("BUNNY_STORAGE_ZONE_NAME", "public", true),
    variable("BUNNY_STORAGE_PULL_ZONE_URL", "public", true),
    variable("BUNNY_STORAGE_PULL_ZONE_TOKEN_KEY", "secret", true),
    variable("BUNNY_STORAGE_API_ENDPOINT", "public", true),
    variable("BUNNY_PROOF_VIDEO_PATH", "public", true)
  ]),
  capability("moderation", true, [
    variable("MEDIA_MODERATION_MODE", "public", true)
  ]),
  capability("live", true, [
    variable("LIVEPEER_API_KEY", "secret", true),
    variable("LIVEPEER_WEBHOOK_SECRET", "secret", true),
    variable("LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY", "secret", true),
    variable("LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY", "public", true),
    variable("LIVEPEER_WEBHOOK_ID", "public", true),
    variable("LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID", "public", true),
    variable("LIVEPEER_ADULT_LIVE_ENABLED", "public", true)
  ]),
  capability("verification", true, [
    variable("AGE_VERIFICATION_DRIVER", "public", true),
    variable("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "public", true)
  ]),
  capability("realtime_push", true, [
    variable("REALTIME_JWT_PRIVATE_JWK", "secret", true),
    variable("REALTIME_JWT_KEY_ID", "public", true),
    variable("REALTIME_JWT_ISSUER", "public", true),
    variable("NOTIFICATION_DEVICE_ENCRYPTION_KEY", "secret", true),
    variable("WEB_PUSH_VAPID_SUBJECT", "public", true),
    variable("WEB_PUSH_VAPID_PUBLIC_KEY", "public", true),
    variable("WEB_PUSH_VAPID_PRIVATE_KEY", "secret", true)
  ]),
  capability("email", true, [
    variable("TRANSACTIONAL_EMAIL_PROVIDER", "public", true),
    variable("RESEND_API_KEY", "secret", true),
    variable("TRANSACTIONAL_EMAIL_FROM", "public", true),
    variable("TRANSACTIONAL_EMAIL_SMOKE_TO", "secret", true)
  ]),
  capability("observability", true, [
    variable("OTEL_REQUIRED", "public", true),
    variable("OTEL_SDK_DISABLED", "public", true),
    variable("OTEL_EXPORTER_OTLP_ENDPOINT", "secret", true)
  ]),
  capability("subscriptions", false, [
    variable("SUBSCRIPTIONS_ENABLED", "public", true),
    variable("SUBSCRIPTIONS_PROVIDER", "public", false),
    variable("SUBSCRIPTIONS_SOLANA_RPC_URL", "secret", false),
    variable("SUBSCRIPTIONS_DEFAULT_MINT", "public", false),
    variable("SUBSCRIPTIONS_COLLECTOR_WALLET", "public", false),
    variable("SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY", "secret", false)
  ], (env) => env.SUBSCRIPTIONS_ENABLED !== "false"),
  capability("enterprise", false, [
    variable("ENTERPRISE_STAGING_SESSION_COOKIE", "secret", false),
    variable("ENTERPRISE_STAGING_ORGANIZATION_ID", "secret", false),
    variable("ENTERPRISE_STAGING_RELATIONSHIP_ID", "secret", false)
  ], (env) => Boolean(env.ENTERPRISE_STAGING_SESSION_COOKIE)),
  capability("mcp", false, [
    variable("MCP_ENABLED", "public", true),
    variable("MCP_PUBLIC_BASE_URL", "public", false)
  ], (env) => env.MCP_ENABLED !== "false"),
  capability("legal_release", true, [
    variable("LEGAL_DOCUMENTS_APPROVED", "public", true),
    variable("LEGAL_TERMS_VERSION", "public", true),
    variable("LEGAL_PRIVACY_VERSION", "public", true),
    variable("LEGAL_CONTACT_EMAIL", "public", true),
    variable("RELEASE_MANIFEST_PATH", "public", true)
  ])
];

export function inspectStagingEnvironment(env = process.env) {
  const globalErrors = validateGlobalSafety(env);
  return stagingCapabilities.map((capability) => {
    const { invalid, blocked } = validateCapability(capability.name, env);
    if (capability.name === "core") invalid.push(...globalErrors);
    const enabled = capability.required || capability.enabledWhen(env);
    if (!enabled) {
      return result(capability, invalid.length ? "INVALID" : "DISABLED", blocked, invalid);
    }

    const missing = capability.variables
      .filter((entry) => entry.required || capability.required)
      .filter((entry) => !present(env[entry.name]))
      .map((entry) => entry.name);
    return result(
      capability,
      invalid.length ? "INVALID" : missing.length || blocked.length ? "BLOCKED" : "READY",
      [...missing, ...blocked],
      invalid
    );
  });
}

export function redactedStagingSummary(env = process.env) {
  return inspectStagingEnvironment(env).map(({ name, status, missing, invalid }) => ({ name, status, missing, invalid }));
}

export function expectedMigrationHead(root = process.cwd()) {
  const files = readdirSync(`${root}/packages/database/migrations`)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
  if (!files.length) throw new Error("No database migrations were found");
  return files.at(-1).replace(/\.sql$/, "");
}

export function environmentFingerprint(env = process.env) {
  const safe = Object.fromEntries(stagingCapabilities.flatMap((capability) => capability.variables)
    .filter((entry) => entry.exposure === "public")
    .map((entry) => [entry.name, env[entry.name] ?? ""]));
  return createHash("sha256").update(JSON.stringify(safe)).digest("hex");
}

export function assertSafeStagingTarget(env = process.env) {
  const errors = validateGlobalSafety(env);
  if (errors.length) throw new StagingSafetyError(errors);
}

export class StagingSafetyError extends Error {
  constructor(publicReasons) {
    super(`Unsafe staging target: ${publicReasons.join(", ")}`);
    this.name = "StagingSafetyError";
    this.publicReasons = publicReasons;
  }
}

function capability(name, required, variables, enabledWhen = () => false) {
  return { name, required, variables, enabledWhen };
}

function variable(name, exposure, required) {
  return { name, exposure, required };
}

function result(capability, status, missing, invalid) {
  return {
    name: capability.name,
    status,
    required: capability.required,
    missing,
    invalid,
    variables: capability.variables.map(({ name, exposure }) => ({ name, exposure }))
  };
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateGlobalSafety(env) {
  const errors = [];
  if (env.DEPLOY_ENV !== "staging") errors.push("DEPLOY_ENV=staging");
  if (env.NODE_ENV === "production" && env.DEPLOY_ENV !== "staging") errors.push("production_mode_target");
  if (env.SUPABASE_PROJECT_REF && env.SUPABASE_PROJECT_REF === env.SUPABASE_PRODUCTION_PROJECT_REF) {
    errors.push("production_project_ref");
  }
  for (const name of [
    "WEB_URL",
    "API_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_API_BASE_URL",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL"
  ]) {
    const value = env[name];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        errors.push(`${name}=https`);
      }
      if (/prod(uction)?/i.test(url.hostname)) errors.push(`${name}=nonproduction_host`);
    } catch {
      errors.push(`${name}=valid_url`);
    }
  }
  if (present(env.SUPABASE_PROJECT_REF)) {
    for (const name of ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (!present(env[name])) continue;
      try {
        const host = new URL(env[name]).hostname;
        if (host !== `${env.SUPABASE_PROJECT_REF}.supabase.co`) errors.push(`${name}=staging_project_ref`);
      } catch {
        // URL syntax is reported by the earlier global URL validation.
      }
    }
    for (const name of ["DATABASE_URL", "SUPABASE_DIRECT_DB_URL"]) {
      if (present(env[name]) && !databaseUrlMatchesProject(env[name], env.SUPABASE_PROJECT_REF)) {
        errors.push(`${name}=staging_project_ref`);
      }
    }
  }
  if (env.NEXT_PUBLIC_ENABLE_E2E_AUTH === "true" || env.ENABLE_E2E_AUTH === "true") errors.push("e2e_auth_disabled");
  return [...new Set(errors)];
}

function databaseUrlMatchesProject(value, projectRef) {
  try {
    const url = new URL(value);
    return url.hostname === `db.${projectRef}.supabase.co`
      || (url.hostname.endsWith(".pooler.supabase.com") && url.username.endsWith(`.${projectRef}`));
  } catch {
    return false;
  }
}

function validateCapability(name, env) {
  const invalid = [];
  const blocked = [];
  const mismatch = (key, expected) => present(env[key]) && env[key] !== expected;
  if (name === "core" && mismatch("NODE_ENV", "production")) invalid.push("NODE_ENV=production");
  if (name === "rate_limiting" && mismatch("API_RATE_LIMIT_STORE_DRIVER", "redis")) invalid.push("API_RATE_LIMIT_STORE_DRIVER=redis");
  if (name === "wallet" && mismatch("NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED", "true")) invalid.push("NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=true");
  if (name === "wallet" && mismatch("NEXT_PUBLIC_SOLANA_CHAIN", "solana:devnet")) invalid.push("NEXT_PUBLIC_SOLANA_CHAIN=solana:devnet");
  if (name === "payments" && mismatch("HELIUS_CLUSTER", "devnet")) invalid.push("HELIUS_CLUSTER=devnet");
  if (name === "payments" && mismatch("SOLANA_CLUSTER", "devnet")) invalid.push("SOLANA_CLUSTER=devnet");
  if (name === "payments" && mismatch("SOLANA_NETWORK", "solana:devnet")) invalid.push("SOLANA_NETWORK=solana:devnet");
  if (name === "moderation" && present(env.MEDIA_MODERATION_MODE) && !["shadow", "enforced", "launch_approved"].includes(env.MEDIA_MODERATION_MODE)) invalid.push("MEDIA_MODERATION_MODE=shadow|enforced|launch_approved");
  if (name === "live" && mismatch("LIVEPEER_ADULT_LIVE_ENABLED", "false")) invalid.push("LIVEPEER_ADULT_LIVE_ENABLED=false");
  if (name === "verification" && mismatch("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "false")) invalid.push("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=false");
  if (name === "email" && mismatch("TRANSACTIONAL_EMAIL_PROVIDER", "resend")) invalid.push("TRANSACTIONAL_EMAIL_PROVIDER=resend");
  if (name === "observability" && mismatch("OTEL_REQUIRED", "true")) invalid.push("OTEL_REQUIRED=true");
  if (name === "observability" && mismatch("OTEL_SDK_DISABLED", "false")) invalid.push("OTEL_SDK_DISABLED=false");
  if (name === "subscriptions" && present(env.SUBSCRIPTIONS_ENABLED) && !["true", "false"].includes(env.SUBSCRIPTIONS_ENABLED)) invalid.push("SUBSCRIPTIONS_ENABLED=true|false");
  if (name === "mcp" && present(env.MCP_ENABLED) && !["true", "false"].includes(env.MCP_ENABLED)) invalid.push("MCP_ENABLED=true|false");
  if (name === "mcp" && env.MCP_ENABLED === "true" && !env.MCP_PUBLIC_BASE_URL) invalid.push("MCP_PUBLIC_BASE_URL=https");
  if (name === "legal_release" && present(env.LEGAL_DOCUMENTS_APPROVED) && env.LEGAL_DOCUMENTS_APPROVED !== "true") blocked.push("LEGAL_DOCUMENTS_APPROVED=true");
  return { invalid, blocked };
}
