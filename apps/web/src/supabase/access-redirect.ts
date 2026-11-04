import type { SessionState } from "../api-client-types";
import { safeSameOriginPath } from "../navigation/safe-same-origin-path";

export function signInRedirectForPath(path: string): string {
  return withNext("/", safeSameOriginPath(path, "/"), { mode: "login" });
}

export function appAccessRedirectForPath(
  path: string,
  reason: SessionState["appAccessState"]["reason"]
): string {
  const next = safeSameOriginPath(path, "/");

  if (reason === "identity_required") {
    return withNext("/", next, { mode: "onboarding", step: "profile" });
  }

  if (reason === "wallet_required") {
    return withNext("/", next, { mode: "onboarding", step: "wallet" });
  }

  if (reason === "age_required" || reason === "age_pending") {
    return withNext("/", next, { mode: "onboarding", step: "age" });
  }

  return withNext("/", next, { mode: "login" });
}

export function walletSessionDestination(
  path: string,
  appAccessState: SessionState["appAccessState"]
): string {
  const next = safeSameOriginPath(path, "/");
  return appAccessState.allowed
    ? next
    : appAccessRedirectForPath(next, appAccessState.reason);
}

function withNext(path: string, next: string, initial?: Record<string, string>) {
  const params = new URLSearchParams({ ...initial, next });
  return `${path}?${params.toString()}`;
}
