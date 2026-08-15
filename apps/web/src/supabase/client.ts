import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readPublicWebEnv } from "@/public-env";

export function createSupabaseBrowserClient() {
  const env = readPublicWebEnv();
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    throw new Error("Supabase browser client is not configured");
  }

  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey);
}

export function createSupabaseRealtimeClient(accessToken: () => Promise<string>) {
  const env = readPublicWebEnv();
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    throw new Error("Supabase Realtime client is not configured");
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey, {
    accessToken,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}
