import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config/public";

export async function createSupabaseServerClient() {
  const env = parsePublicWebEnv(process.env);
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot persist refreshed cookies; proxy handles refresh.
        }
      }
    }
  });
}
