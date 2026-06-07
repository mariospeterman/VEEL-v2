import { createSupabaseServerClient } from "./server";

export interface WebAuthState {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
}

export async function getWebAuthState(): Promise<WebAuthState> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      configured: false,
      authenticated: false,
      email: null
    };
  }

  const { data, error } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return {
    configured: true,
    authenticated: !error && Boolean(data?.claims),
    email
  };
}
