import { createBrowserClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config/public";

export function createSupabaseBrowserClient() {
  const env = parsePublicWebEnv(process.env);
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    throw new Error("Supabase browser client is not configured");
  }

  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey);
}
