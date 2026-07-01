"use client";

import type { Provider } from "@supabase/supabase-js";
import { readPublicWebEnv } from "@/public-env";

export type RecoveryAuthProvider = {
  envKey: keyof ReturnType<typeof readPublicWebEnv>;
  label: string;
  logo: "discord" | "github" | "google" | "x";
  provider: Extract<Provider, "discord" | "github" | "google" | "twitter">;
};

export const recoveryOAuthProviders: RecoveryAuthProvider[] = [
  {
    envKey: "NEXT_PUBLIC_SUPABASE_AUTH_GOOGLE_ENABLED",
    label: "Google",
    logo: "google",
    provider: "google"
  },
  {
    envKey: "NEXT_PUBLIC_SUPABASE_AUTH_GITHUB_ENABLED",
    label: "GitHub",
    logo: "github",
    provider: "github"
  },
  {
    envKey: "NEXT_PUBLIC_SUPABASE_AUTH_DISCORD_ENABLED",
    label: "Discord",
    logo: "discord",
    provider: "discord"
  },
  {
    envKey: "NEXT_PUBLIC_SUPABASE_AUTH_TWITTER_ENABLED",
    label: "X",
    logo: "x",
    provider: "twitter"
  }
];

export function getRecoveryAuthConfig() {
  const env = readPublicWebEnv();
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && supabaseKey);

  return {
    emailEnabled: supabaseConfigured && env.NEXT_PUBLIC_SUPABASE_AUTH_EMAIL_ENABLED,
    oauthProviders: supabaseConfigured
      ? recoveryOAuthProviders.filter((provider) => Boolean(env[provider.envKey]))
      : [],
    supabaseConfigured
  };
}
