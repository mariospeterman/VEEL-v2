import { cookies } from "next/headers";
import { parsePublicWebEnv } from "@veel/config/public";
import type { WebAuthState } from "./auth-state";
import { e2eAuthCookieName } from "./auth-cookie";

export function isE2eAuthEnabled(env = process.env) {
  return env.NODE_ENV !== "production" && parsePublicWebEnv(env).NEXT_PUBLIC_ENABLE_E2E_AUTH;
}

export async function getE2eAccessToken() {
  if (!isE2eAuthEnabled()) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(e2eAuthCookieName)?.value;

  return token && token.length > 0 ? token : null;
}

export async function getE2eAuthState(): Promise<WebAuthState | null> {
  const token = await getE2eAccessToken();

  if (!token) {
    return null;
  }

  return {
    configured: true,
    authenticated: true,
    email: "creator@veel.test"
  };
}
