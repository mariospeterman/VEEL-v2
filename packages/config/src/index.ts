import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
export { parsePublicWebEnv, publicWebEnvSchema, type PublicWebEnv } from "./public.js";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalStringSchema = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrlSchema = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalEmailSchema = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalCookieDomainSchema = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^(?:\.)?[A-Za-z0-9.-]+$/).optional()
);
const optionalBooleanSchema = (defaultValue: boolean) =>
  z.preprocess(emptyToUndefined, z.coerce.boolean().default(defaultValue));

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  API_URL: z.string().url().default("http://localhost:4000"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: optionalUrlSchema,
  SUPABASE_PROJECT_REF: optionalStringSchema,
  SUPABASE_PUBLISHABLE_KEY: optionalStringSchema,
  SUPABASE_SECRET_KEY: optionalStringSchema,
  SUPABASE_SERVICE_ROLE_KEY: optionalStringSchema,
  PROFILE_AVATAR_BUCKET: z.string().default("profile-avatars"),
  DATABASE_URL: optionalStringSchema,
  PRIVY_APP_SECRET: optionalStringSchema,
  PRIVY_JWKS_ENDPOINT: optionalUrlSchema,
  SOLANA_CLUSTER: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  SOLANA_NETWORK: z.enum(["solana:devnet", "solana:mainnet"]).default("solana:devnet"),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  SOLANA_WS_URL: optionalUrlSchema,
  PAYMENT_DEFAULT_ASSET: z.enum(["SOL"]).default("SOL"),
  PAYMENT_PLATFORM_FEE_WALLET: optionalStringSchema,
  PAYMENT_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(1_000),
  PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(2_000),
  PAYMENT_PLATFORM_TREASURY_WALLET: optionalStringSchema,
  SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: z
    .string()
    .default("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"),
  SOLANA_SUBSCRIPTION_USDC_MINT: optionalStringSchema,
  SOLANA_SUBSCRIPTION_COLLECTOR_WALLET: optionalStringSchema,
  SUBSCRIPTIONS_ENABLED: z.coerce.boolean().default(false),
  SUBSCRIPTIONS_PROVIDER: z
    .enum(["disabled", "official_solana_subscription_program", "mock_subscription_provider_dev_only"])
    .default("disabled"),
  SUBSCRIPTIONS_SOLANA_PROGRAM_ID: z
    .string()
    .default("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"),
  SUBSCRIPTIONS_SOLANA_NETWORK: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  SUBSCRIPTIONS_SOLANA_RPC_URL: optionalUrlSchema,
  SUBSCRIPTIONS_SUPPORTED_MINTS: optionalStringSchema,
  SUBSCRIPTIONS_DEFAULT_MINT: optionalStringSchema,
  SUBSCRIPTIONS_COLLECTOR_WALLET: optionalStringSchema,
  SUBSCRIPTIONS_MERCHANT_WALLET: optionalStringSchema,
  SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION: z.coerce.boolean().default(true),
  HELIUS_API_KEY: optionalStringSchema,
  HELIUS_WEBHOOK_SECRET: optionalStringSchema,
  HELIUS_CLUSTER: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  HELIUS_API_BASE_URL: optionalUrlSchema,
  HELIUS_RPC_URL: optionalUrlSchema,
  HELIUS_WEBHOOK_CLUSTER: z.preprocess(emptyToUndefined, z.enum(["devnet", "mainnet-beta"]).optional()),
  ONRAMP_PROVIDER: z.enum(["disabled", "coinbase"]).default("disabled"),
  ONRAMP_PURCHASE_CURRENCY: z.enum(["SOL", "USDC"]).default("SOL"),
  WALLET_AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  WALLET_AUTH_COOKIE_DOMAIN: optionalCookieDomainSchema,
  COINBASE_CDP_API_KEY_ID: optionalStringSchema,
  COINBASE_CDP_API_KEY_SECRET: optionalStringSchema,
  COINBASE_CDP_API_BASE_URL: z.string().url().default("https://api.cdp.coinbase.com"),
  COINBASE_ONRAMP_DESTINATION_NETWORK: z.string().default("solana"),
  BUNNY_STREAM_API_KEY: optionalStringSchema,
  BUNNY_STREAM_LIBRARY_ID: optionalStringSchema,
  BUNNY_STREAM_EMBED_TOKEN_KEY: optionalStringSchema,
  BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  BUNNY_STREAM_WEBHOOK_READONLY_KEY: optionalStringSchema,
  LIVEPEER_API_KEY: optionalStringSchema,
  LIVEPEER_WEBHOOK_SECRET: optionalStringSchema,
  LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: optionalStringSchema,
  LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: optionalStringSchema,
  LIVEPEER_API_BASE_URL: optionalUrlSchema,
  LIVEPEER_BROWSER_BROADCAST_REDIRECT_BASE_URL: optionalUrlSchema,
  LIVEPEER_WEBHOOK_ID: optionalStringSchema,
  LIVEPEER_PLAYBACK_JWT_PUBLIC_KEY: optionalStringSchema,
  LIVEPEER_PLAYBACK_JWT_PRIVATE_KEY_PATH: optionalStringSchema,
  AGE_VERIFICATION_DRIVER: z
    .preprocess(emptyToUndefined, z.enum(["yoti_digital_id", "yoti", "sumsub", "veriff", "persona"]).optional()),
  AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: z.coerce.boolean().default(false),
  AGE_VERIFICATION_PROVIDER_SELECTION_ENABLED: z.coerce.boolean().default(true),
  AGE_VERIFICATION_PREFER_REUSABLE_CREDENTIALS: z.coerce.boolean().default(true),
  AGE_VERIFICATION_REUSABLE_PROVIDERS: z.string().default("didit_reusable,yoti_digital_id,eudi_wallet,scytales"),
  AGE_VERIFICATION_FALLBACK_PROVIDERS: z.string().default("didit_age_estimation,persona_document"),
  AGE_VERIFICATION_FALLBACK_ORDER: z.string().default("reusable_credential,age_estimation,free_document,portable_credential,database_non_doc,document"),
  AGE_VERIFICATION_REVERIFY_MODE: z.enum(["risk_or_expiry", "fixed_interval"]).default("risk_or_expiry"),
  AGE_VERIFICATION_REVERIFY_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  SUMSUB_APP_TOKEN: optionalStringSchema,
  SUMSUB_SECRET_KEY: optionalStringSchema,
  SUMSUB_WEBHOOK_SECRET: optionalStringSchema,
  SUMSUB_LEVEL_NAME: optionalStringSchema,
  SUMSUB_CREATOR_KYC_LEVEL_NAME: optionalStringSchema,
  SUMSUB_ORG_KYB_LEVEL_NAME: optionalStringSchema,
  SUMSUB_API_BASE_URL: z.string().url().default("https://api.sumsub.com"),
  DIDIT_API_KEY: optionalStringSchema,
  DIDIT_WEBHOOK_SECRET: optionalStringSchema,
  DIDIT_AGE_WORKFLOW_ID: optionalStringSchema,
  DIDIT_KYC_WORKFLOW_ID: optionalStringSchema,
  DIDIT_KYB_WORKFLOW_ID: optionalStringSchema,
  DIDIT_API_BASE_URL: z.string().url().default("https://verification.didit.me"),
  YOTI_SDK_ID: optionalStringSchema,
  YOTI_API_TOKEN: optionalStringSchema,
  YOTI_NOTIFICATION_KEY_PATH: optionalStringSchema,
  YOTI_API_BASE_URL: z.string().url().default("https://age.yoti.com/api/v1"),
  YOTI_LAUNCH_BASE_URL: z.string().url().default("https://age.yoti.com"),
  VERIFF_API_KEY: optionalStringSchema,
  VERIFF_SHARED_SECRET: optionalStringSchema,
  VERIFF_API_BASE_URL: z.string().url().default("https://stationapi.veriff.com"),
  PERSONA_API_KEY: optionalStringSchema,
  PERSONA_WEBHOOK_SECRET: optionalStringSchema,
  PERSONA_TEMPLATE_ID: optionalStringSchema,
  PERSONA_CREATOR_KYC_TEMPLATE_ID: optionalStringSchema,
  PERSONA_ORG_KYB_TEMPLATE_ID: optionalStringSchema,
  PERSONA_API_BASE_URL: z.string().url().default("https://api.withpersona.com"),
  NOTIFICATION_DEVICE_ENCRYPTION_KEY: optionalStringSchema,
  WEB_PUSH_VAPID_SUBJECT: optionalStringSchema,
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalStringSchema,
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalStringSchema,
  TRANSACTIONAL_EMAIL_PROVIDER: z.enum(["disabled", "resend"]).default("disabled"),
  TRANSACTIONAL_EMAIL_FROM: optionalStringSchema,
  TRANSACTIONAL_EMAIL_REPLY_TO: optionalStringSchema,
  RESEND_API_KEY: optionalStringSchema,
  TRANSACTIONAL_EMAIL_SMOKE_TO: optionalEmailSchema,
  WORKER_TICK_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  WORKER_BATCH_LIMIT: z.coerce.number().int().min(1).max(250).default(25),
  MCP_ENABLED: z.coerce.boolean().default(false),
  MCP_PUBLIC_BASE_URL: optionalUrlSchema,
  MCP_AUTH_MODE: z.enum(["oauth", "scoped_token"]).default("oauth"),
  MCP_ALLOWED_CLIENTS: z.string().default(""),
  MCP_REQUIRE_OAUTH: z.coerce.boolean().default(true),
  MCP_ALLOW_STATIC_TOKENS_DEV: z.coerce.boolean().default(false),
  MCP_TOOL_CALL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(30),
  MCP_CONNECTION_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(86_400),
  MCP_OAUTH_AUTH_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  MCP_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(2_555).default(365),
  MCP_OAUTH_SEED_PROFILE: optionalStringSchema,
  MCP_OAUTH_CLIENT_NAME: optionalStringSchema,
  MCP_OAUTH_CLIENT_TYPE: optionalStringSchema,
  MCP_OAUTH_CLIENT_ID: optionalStringSchema,
  MCP_OAUTH_REDIRECT_URIS: optionalStringSchema,
  MCP_OAUTH_ALLOWED_SCOPES: optionalStringSchema,
  MCP_OAUTH_PUBLIC_CLIENT: optionalBooleanSchema(true),
  MCP_OAUTH_CLIENT_SECRET: optionalStringSchema,
  MCP_TEST_ACCESS_TOKEN: optionalStringSchema,
  MCP_TEST_EXPECTED_TOOL: optionalStringSchema,
  MCP_TEST_FORBIDDEN_TOOL: optionalStringSchema,
  MCP_TEST_CONNECTION_ID: optionalStringSchema
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const parseServerEnv = (env: NodeJS.ProcessEnv): ServerEnv => serverEnvSchema.parse(env);

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function parseAes256GcmKey(value?: string): Buffer | null {
  if (!value) return null;

  const normalized = value.trim();
  const key = Buffer.from(normalized, normalized.includes("-") || normalized.includes("_") ? "base64url" : "base64");
  if (key.length !== 32) {
    throw new Error("NOTIFICATION_DEVICE_ENCRYPTION_KEY must be a 32-byte base64 or base64url value");
  }

  return key;
}

export function encryptSecret(value: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
