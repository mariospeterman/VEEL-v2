import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalStringSchema = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrlSchema = z.preprocess(emptyToUndefined, z.string().url().optional());

const publicBooleanSchema = z
  .preprocess(emptyToUndefined, z.union([z.boolean(), z.literal("true"), z.literal("false")]).default(false))
  .default(false)
  .transform((value) => value === true || value === "true");

export const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrlSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalStringSchema,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalStringSchema,
  NEXT_PUBLIC_PRIVY_APP_ID: optionalStringSchema,
  NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID: optionalStringSchema,
  NEXT_PUBLIC_TURNKEY_API_BASE_URL: optionalUrlSchema,
  NEXT_PUBLIC_TURNKEY_AUTH_PROXY_URL: optionalUrlSchema,
  NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID: optionalStringSchema,
  NEXT_PUBLIC_SOLANA_CHAIN: z.enum(["solana:devnet", "solana:mainnet"]).default("solana:devnet"),
  NEXT_PUBLIC_SOLANA_RPC_URL: optionalUrlSchema,
  NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL: optionalUrlSchema,
  NEXT_PUBLIC_ENABLE_E2E_AUTH: publicBooleanSchema,
  NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED: publicBooleanSchema
});

export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;

export const parsePublicWebEnv = (env: NodeJS.ProcessEnv): PublicWebEnv => publicWebEnvSchema.parse(env);
