import type { ApiResult } from "./api-client";

export type ApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "service_unavailable"
  | "network"
  | "unknown";

export type ApiErrorView = {
  kind: ApiErrorKind;
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  retryable: boolean;
  status?: number;
  debugMessage?: string;
};

export function mapApiFailure(
  failure: Extract<ApiResult<unknown>, { ok: false }>,
  context = "This section"
): ApiErrorView {
  const base = {
    status: failure.status,
    debugMessage: failure.message
  };

  if (failure.status === 401) {
    return {
      ...base,
      kind: "unauthenticated",
      title: "Sign in to continue",
      message: `${context} is available after your VEEL session is active.`,
      actionLabel: "Enter VEEL",
      actionHref: "/enter",
      retryable: false
    };
  }

  if (failure.status === 403) {
    return {
      ...base,
      kind: "forbidden",
      title: "Access is not available",
      message: "Your account does not currently have access to this area.",
      retryable: false
    };
  }

  if (failure.status === 404) {
    return {
      ...base,
      kind: "not_found",
      title: "Nothing found",
      message: "The item may have moved, expired, or is not visible to this account.",
      retryable: false
    };
  }

  if (failure.status === 409) {
    return {
      ...base,
      kind: "conflict",
      title: "State changed",
      message: "Refresh and try again with the latest account state.",
      retryable: true
    };
  }

  if (failure.status === 422 || failure.status === 400) {
    return {
      ...base,
      kind: "validation",
      title: "Check the details",
      message: "One or more details need attention before this can continue.",
      retryable: false
    };
  }

  if (failure.status === 429) {
    return {
      ...base,
      kind: "rate_limited",
      title: "Too many attempts",
      message: "Pause briefly before trying again.",
      retryable: true
    };
  }

  if (failure.status >= 500) {
    return {
      ...base,
      kind: failure.message === "API is unavailable" ? "network" : "service_unavailable",
      title: "Service temporarily unavailable",
      message: "This area could not load right now. Try again in a moment.",
      retryable: true
    };
  }

  return {
    ...base,
    kind: "unknown",
    title: "Could not load this area",
    message: "Try again or return to the previous screen.",
    retryable: true
  };
}
