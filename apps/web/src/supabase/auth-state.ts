import { createSupabaseServerClient } from "./server";
import { getE2eAuthState } from "./e2e-auth";

export interface WebAuthState {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
}

export async function getWebAuthState(): Promise<WebAuthState> {
  const e2eAuthState = await getE2eAuthState();
  if (e2eAuthState) {
    return e2eAuthState;
  }

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
