import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalStringSchema = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrlSchema = z.preprocess(emptyToUndefined, z.string().url().optional());

export type SolanaCluster = "devnet" | "mainnet-beta";
export type SolanaChain = "solana:devnet" | "solana:mainnet";

export function solanaChainForCluster(cluster: SolanaCluster): SolanaChain {
  return cluster === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
}

export function assertCompatibleSolanaEnvironment(
  env: Record<string, unknown>,
  canonicalCluster?: SolanaCluster
): void {
  const cluster = canonicalCluster ?? explicitCluster(env.SOLANA_CLUSTER);
  if (!cluster) return;

  const expectedChain = solanaChainForCluster(cluster);
  const contradictions = [
    ["SOLANA_NETWORK", env.SOLANA_NETWORK, expectedChain],
    ["NEXT_PUBLIC_SOLANA_CHAIN", env.NEXT_PUBLIC_SOLANA_CHAIN, expectedChain],
    ["HELIUS_CLUSTER", env.HELIUS_CLUSTER, cluster],
    ["HELIUS_WEBHOOK_CLUSTER", env.HELIUS_WEBHOOK_CLUSTER, cluster],
    ["SUBSCRIPTIONS_SOLANA_NETWORK", env.SUBSCRIPTIONS_SOLANA_NETWORK, cluster]
  ].filter(([, actual, expected]) => typeof actual === "string" && actual !== "" && actual !== expected);

  if (contradictions.length > 0) {
    throw new Error(
      `Contradictory Solana environment: ${contradictions
        .map(([name, actual, expected]) => `${name}=${actual} (expected ${expected})`)
        .join(", ")}`
    );
  }
}

function explicitCluster(value: unknown): SolanaCluster | undefined {
  return value === "devnet" || value === "mainnet-beta" ? value : undefined;
}

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
  NEXT_PUBLIC_SUPABASE_AUTH_EMAIL_ENABLED: publicBooleanSchema,
  NEXT_PUBLIC_SUPABASE_AUTH_GOOGLE_ENABLED: publicBooleanSchema,
  NEXT_PUBLIC_SUPABASE_AUTH_GITHUB_ENABLED: publicBooleanSchema,
  NEXT_PUBLIC_SUPABASE_AUTH_DISCORD_ENABLED: publicBooleanSchema,
  NEXT_PUBLIC_SUPABASE_AUTH_TWITTER_ENABLED: publicBooleanSchema,
  NEXT_PUBLIC_PRIVY_APP_ID: optionalStringSchema,
  NEXT_PUBLIC_SOLANA_CHAIN: z.enum(["solana:devnet", "solana:mainnet"]).default("solana:devnet"),
  NEXT_PUBLIC_SOLANA_RPC_URL: optionalUrlSchema,
  NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL: optionalUrlSchema,
  NEXT_PUBLIC_ENABLE_E2E_AUTH: publicBooleanSchema,
  NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED: publicBooleanSchema
}).superRefine((env, context) => {
  if (
    env.NEXT_PUBLIC_SOLANA_CHAIN === "solana:mainnet" &&
    (!env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      env.NEXT_PUBLIC_SOLANA_RPC_URL === "https://api.devnet.solana.com")
  ) {
    context.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_SOLANA_RPC_URL must explicitly select an approved mainnet RPC",
      path: ["NEXT_PUBLIC_SOLANA_RPC_URL"]
    });
  }
});

export type PublicWebEnv = z.infer<typeof publicWebEnvSchema>;

export const parsePublicWebEnv = (env: unknown): PublicWebEnv => publicWebEnvSchema.parse(env);
