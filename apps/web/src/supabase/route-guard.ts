import { redirect } from "next/navigation";
import { getSession } from "../api-client";
import { appAccessRedirectForPath, signInRedirectForPath } from "./access-redirect";
import { getWebAuthState } from "./auth-state";

export { appAccessRedirectForPath, signInRedirectForPath } from "./access-redirect";

export async function requireConfiguredSession(path: string) {
  const authState = await getWebAuthState();

  if (authState.configured && !authState.authenticated) {
    redirect(signInRedirectForPath(path) as Parameters<typeof redirect>[0]);
  }

  return authState;
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
