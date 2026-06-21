import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
export { parsePublicWebEnv, publicWebEnvSchema, type PublicWebEnv } from "./public.js";

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  API_URL: z.string().url().default("http://localhost:4000"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SOLANA_CLUSTER: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  SOLANA_NETWORK: z.enum(["solana:devnet", "solana:mainnet"]).default("solana:devnet"),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  PAYMENT_DEFAULT_ASSET: z.enum(["SOL"]).default("SOL"),
  PAYMENT_PLATFORM_FEE_WALLET: z.string().optional(),
  PAYMENT_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(1_000),
  PAYMENT_PLATFORM_TREASURY_WALLET: z.string().optional(),
  SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: z
    .string()
    .default("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"),
  SOLANA_SUBSCRIPTION_USDC_MINT: z.string().optional(),
  SOLANA_SUBSCRIPTION_COLLECTOR_WALLET: z.string().optional(),
  SUBSCRIPTIONS_ENABLED: z.coerce.boolean().default(false),
  SUBSCRIPTIONS_PROVIDER: z
    .enum(["disabled", "official_solana_subscription_program", "mock_subscription_provider_dev_only"])
    .default("disabled"),
  SUBSCRIPTIONS_SOLANA_PROGRAM_ID: z
    .string()
    .default("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"),
  SUBSCRIPTIONS_SOLANA_NETWORK: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  SUBSCRIPTIONS_SOLANA_RPC_URL: z.string().url().optional(),
  SUBSCRIPTIONS_SUPPORTED_MINTS: z.string().optional(),
  SUBSCRIPTIONS_DEFAULT_MINT: z.string().optional(),
  SUBSCRIPTIONS_COLLECTOR_WALLET: z.string().optional(),
  SUBSCRIPTIONS_MERCHANT_WALLET: z.string().optional(),
  SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION: z.coerce.boolean().default(true),
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  HELIUS_CLUSTER: z.enum(["devnet", "mainnet-beta"]).default("devnet"),
  ONRAMP_PROVIDER: z.enum(["disabled", "coinbase"]).default("disabled"),
  ONRAMP_PURCHASE_CURRENCY: z.enum(["SOL", "USDC"]).default("SOL"),
  WALLET_AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  COINBASE_CDP_API_KEY_ID: z.string().optional(),
  COINBASE_CDP_API_KEY_SECRET: z.string().optional(),
  COINBASE_CDP_API_BASE_URL: z.string().url().default("https://api.cdp.coinbase.com"),
  COINBASE_ONRAMP_DESTINATION_NETWORK: z.string().default("solana"),
  BUNNY_STREAM_API_KEY: z.string().optional(),
  BUNNY_STREAM_LIBRARY_ID: z.string().optional(),
  BUNNY_STREAM_EMBED_TOKEN_KEY: z.string().optional(),
  BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  BUNNY_STREAM_WEBHOOK_READONLY_KEY: z.string().optional(),
  LIVEPEER_API_KEY: z.string().optional(),
  LIVEPEER_WEBHOOK_SECRET: z.string().optional(),
  LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: z.string().optional(),
  LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: z.string().optional(),
  AGE_VERIFICATION_DRIVER: z
    .enum(["yoti_digital_id", "yoti", "sumsub", "veriff", "persona"])
    .optional(),
  AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: z.coerce.boolean().default(false),
  AGE_VERIFICATION_PROVIDER_SELECTION_ENABLED: z.coerce.boolean().default(true),
  AGE_VERIFICATION_PREFER_REUSABLE_CREDENTIALS: z.coerce.boolean().default(true),
  AGE_VERIFICATION_REUSABLE_PROVIDERS: z.string().default("didit_reusable,yoti_digital_id,eudi_wallet,scytales"),
  AGE_VERIFICATION_FALLBACK_PROVIDERS: z.string().default("didit_age_estimation,persona_document"),
  AGE_VERIFICATION_FALLBACK_ORDER: z.string().default("reusable_credential,age_estimation,free_document,portable_credential,database_non_doc,document"),
  AGE_VERIFICATION_REVERIFY_MODE: z.enum(["risk_or_expiry", "fixed_interval"]).default("risk_or_expiry"),
  AGE_VERIFICATION_REVERIFY_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  SUMSUB_APP_TOKEN: z.string().optional(),
  SUMSUB_SECRET_KEY: z.string().optional(),
  SUMSUB_WEBHOOK_SECRET: z.string().optional(),
  SUMSUB_LEVEL_NAME: z.string().optional(),
  SUMSUB_API_BASE_URL: z.string().url().default("https://api.sumsub.com"),
  YOTI_SDK_ID: z.string().optional(),
  YOTI_API_TOKEN: z.string().optional(),
  YOTI_NOTIFICATION_KEY_PATH: z.string().optional(),
  YOTI_API_BASE_URL: z.string().url().default("https://age.yoti.com/api/v1"),
  YOTI_LAUNCH_BASE_URL: z.string().url().default("https://age.yoti.com"),
  VERIFF_API_KEY: z.string().optional(),
  VERIFF_SHARED_SECRET: z.string().optional(),
  VERIFF_API_BASE_URL: z.string().url().default("https://stationapi.veriff.com"),
  PERSONA_API_KEY: z.string().optional(),
  PERSONA_WEBHOOK_SECRET: z.string().optional(),
  PERSONA_TEMPLATE_ID: z.string().optional(),
  PERSONA_API_BASE_URL: z.string().url().default("https://api.withpersona.com"),
  NOTIFICATION_DEVICE_ENCRYPTION_KEY: z.string().optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().optional(),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  TRANSACTIONAL_EMAIL_PROVIDER: z.enum(["disabled", "resend"]).default("disabled"),
  TRANSACTIONAL_EMAIL_FROM: z.string().optional(),
  TRANSACTIONAL_EMAIL_REPLY_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TRANSACTIONAL_EMAIL_SMOKE_TO: z.string().email().optional(),
  MCP_ENABLED: z.coerce.boolean().default(false),
  MCP_PUBLIC_BASE_URL: z.string().url().optional(),
  MCP_AUTH_MODE: z.enum(["oauth", "scoped_token"]).default("oauth"),
  MCP_ALLOWED_CLIENTS: z.string().default(""),
  MCP_REQUIRE_OAUTH: z.coerce.boolean().default(true),
  MCP_ALLOW_STATIC_TOKENS_DEV: z.coerce.boolean().default(false),
  MCP_TOOL_CALL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(30),
  MCP_CONNECTION_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(86_400),
  MCP_OAUTH_AUTH_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  MCP_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(2_555).default(365)
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
