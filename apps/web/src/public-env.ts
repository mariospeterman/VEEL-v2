import { parsePublicWebEnv, type PublicWebEnv } from "@veel/config/public";

declare global {
  var __WEVID_PUBLIC_ENV__: PublicWebEnv | undefined;
}

const publicEnvKeys = [
  "NODE_ENV",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_AUTH_EMAIL_ENABLED",
  "NEXT_PUBLIC_SUPABASE_AUTH_GOOGLE_ENABLED",
  "NEXT_PUBLIC_SUPABASE_AUTH_GITHUB_ENABLED",
  "NEXT_PUBLIC_SUPABASE_AUTH_DISCORD_ENABLED",
  "NEXT_PUBLIC_SUPABASE_AUTH_TWITTER_ENABLED",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_SOLANA_CHAIN",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL",
  "NEXT_PUBLIC_ENABLE_E2E_AUTH",
  "NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED"
] as const;

export function readPublicWebEnv() {
  if (globalThis.__WEVID_PUBLIC_ENV__) {
    return parsePublicWebEnv(globalThis.__WEVID_PUBLIC_ENV__);
  }

  if (typeof window !== "undefined") throw new Error("WeVid runtime configuration is unavailable");

  return readServerPublicWebEnv(process.env);
}

export function readServerPublicWebEnv(env: NodeJS.ProcessEnv): PublicWebEnv {
  return parsePublicWebEnv(
    Object.fromEntries(publicEnvKeys.map((key) => [key, env[key]]))
  );
}

export function serializePublicWebEnvScript(env: PublicWebEnv): string {
  const serialized = JSON.stringify(env)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `globalThis.__WEVID_PUBLIC_ENV__=${serialized};`;
}
