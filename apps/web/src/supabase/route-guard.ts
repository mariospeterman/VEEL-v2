import { redirect } from "next/navigation";
import { getWebAuthState } from "./auth-state";

export function signInRedirectForPath(path: string): string {
  const params = new URLSearchParams({ next: path });
  return `/enter?${params.toString()}`;
}

export async function requireConfiguredSession(path: string) {
  const authState = await getWebAuthState();

  if (authState.configured && !authState.authenticated) {
    redirect(signInRedirectForPath(path) as Parameters<typeof redirect>[0]);
  }

  return authState;
}
