import { redirect } from "next/navigation";
import { getSession, type SessionState } from "../api-client";
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

export function appAccessRedirectForPath(
  path: string,
  reason: SessionState["appAccessState"]["reason"]
): string {
  const next = safeNext(path);

  if (reason === "wallet_required") {
    return withNext("/wallet", next);
  }

  if (reason === "age_required" || reason === "age_pending") {
    return withNext("/age", next);
  }

  return withNext("/enter", next);
}

export async function requireAppAccess(path: string) {
  const authState = await requireConfiguredSession(path);

  if (!authState.configured || !authState.authenticated) {
    return null;
  }

  const session = await getSession();

  if (!session.ok) {
    if (session.status === 401) {
      redirect(signInRedirectForPath(path) as Parameters<typeof redirect>[0]);
    }

    return null;
  }

  if (!session.data.appAccessState.allowed) {
    redirect(
      appAccessRedirectForPath(path, session.data.appAccessState.reason) as Parameters<
        typeof redirect
      >[0]
    );
  }

  return session.data;
}

function safeNext(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function withNext(path: string, next: string) {
  const params = new URLSearchParams({ next });
  return `${path}?${params.toString()}`;
}
