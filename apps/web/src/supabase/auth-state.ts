import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./server";
import { getE2eAuthState } from "./e2e-auth";

export interface WebAuthState {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
  method?: "wallet" | "supabase" | "e2e";
}

export async function getWebAuthState(): Promise<WebAuthState> {
  const e2eAuthState = await getE2eAuthState();
  if (e2eAuthState) {
    return { ...e2eAuthState, method: "e2e" };
  }

  const cookieStore = await cookies();
  if (cookieStore.get("veel_wallet_session_token")?.value) {
    return {
      configured: true,
      authenticated: true,
      email: null,
      method: "wallet"
    };
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

  if (error || !data?.claims) {
    return {
      configured: true,
      authenticated: false,
      email
    };
  }

  return {
    configured: true,
    authenticated: true,
    email,
    method: "supabase"
  };
}
