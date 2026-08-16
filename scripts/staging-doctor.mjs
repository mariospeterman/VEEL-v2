#!/usr/bin/env node

const groups = [
  ["core", ["WEB_URL", "API_URL", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_PROJECT_REF", "SUPABASE_PUBLISHABLE_KEY"]],
  ["payments", ["SOLANA_RPC_URL", "PAYMENT_PLATFORM_FEE_WALLET", "HELIUS_WEBHOOK_SECRET"]],
  ["vod", ["BUNNY_STREAM_API_KEY", "BUNNY_STREAM_LIBRARY_ID", "BUNNY_STREAM_EMBED_TOKEN_KEY", "BUNNY_STREAM_WEBHOOK_READONLY_KEY"]],
  ["live", ["LIVEPEER_API_KEY", "LIVEPEER_WEBHOOK_SECRET", "LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY", "LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY", "LIVEPEER_WEBHOOK_ID", "LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID"]],
  ["age", ["AGE_VERIFICATION_DRIVER"]],
  ["notifications", ["NOTIFICATION_DEVICE_ENCRYPTION_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY"]],
  ["operations", ["API_RATE_LIMIT_REDIS_URL", "OTEL_EXPORTER_OTLP_ENDPOINT", "RELEASE_MANIFEST_PATH"]],
  ["legal", ["LEGAL_DOCUMENTS_APPROVED", "LEGAL_TERMS_VERSION", "LEGAL_PRIVACY_VERSION", "LEGAL_CONTACT_EMAIL"]]
];

const results = groups.map(([name, names]) => {
  const missing = names.filter((key) => !process.env[key]?.trim());
  return { name, status: missing.length === 0 ? "READY" : "CODE_COMPLETE_PROVIDER_BLOCKED", missing };
});

for (const result of results) {
  console.log(`${result.status} ${result.name}${result.missing.length ? ` missing=${result.missing.join(",")}` : ""}`);
}

const incomplete = results.filter((result) => result.status !== "READY");
if (process.env.STAGING_REQUIRE_COMPLETE === "true" && incomplete.length > 0) {
  throw new Error(`Staging convergence is incomplete in ${incomplete.length} group(s)`);
}
