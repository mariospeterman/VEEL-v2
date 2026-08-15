import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./server";
import { getE2eAuthState } from "./e2e-auth";

export interface WebAuthState {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
  method?: "wallet" | "e2e";
}

export async function getWebAuthState(): Promise<WebAuthState> {
  const e2eAuthState = await getE2eAuthState();
  if (e2eAuthState) {
    return { ...e2eAuthState, method: "e2e" };
  }

  const cookieStore = await cookies();
  if (cookieStore.get("wevid_session")?.value) {
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

  return {
    configured: true,
    authenticated: false,
    email: null
  };
}
