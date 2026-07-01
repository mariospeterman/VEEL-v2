import type { ApiResult } from "./api-client";
import { ApiMutationError } from "./api-mutation-types";

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
      message: `${context} is available after your WeVid session is active.`,
      actionLabel: "Enter WeVid",
      actionHref: "/?mode=login",
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

export function safeMutationMessage(error: unknown, context = "This action") {
  if (error instanceof ApiMutationError) {
    if (error.message === "API is unavailable") {
      return `${context} reached the wallet, but the WeVid API is not available. Start the API and try again.`;
    }

    if (!error.status && error.message) {
      return error.message;
    }

    return mapStatusToMessage(error.status, context);
  }

  return `${context} could not complete right now. Try again in a moment.`;
}

function mapStatusToMessage(status: number | undefined, context: string) {
  if (status === 401) return "Sign in or reconnect your wallet before continuing.";
  if (status === 403) return "Your account does not currently have access to complete this action.";
  if (status === 404) return "This item is no longer available.";
  if (status === 409) return "The state changed. Refresh and try again.";
  if (status === 400 || status === 422) return "Check the details and try again.";
  if (status === 429) return "Too many attempts. Pause briefly before trying again.";
  if (status && status >= 500) return `${context} is temporarily unavailable. Try again in a moment.`;

  return `${context} could not complete right now. Try again in a moment.`;
}
