"use client";

import { parsePublicWebEnv } from "@veel/config/public";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { getWalletSessionToken } from "@/wallet/wallet-session";
import { ApiMutationError } from "./api-mutation-types";

const browserE2eAuthEnabled =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_E2E_AUTH === "true";

export async function authenticatedGet<T>(path: string): Promise<T> {
  const { token } = await browserSessionToken();
  const env = parsePublicWebEnv(process.env);
  const response = await mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function authenticatedMutation<T>(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<T> {
  const response = await sendAuthenticatedMutation(path, method, body);

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function authenticatedEmptyMutation(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<void> {
  const response = await sendAuthenticatedMutation(path, method, body);

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }
}

export async function publicMutation<T>(
  path: string,
  method: "POST",
  body: unknown
): Promise<T> {
  const env = parsePublicWebEnv(process.env);
  const response = await mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": mutationIdempotencyKey()
    },
    method
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function sendAuthenticatedMutation(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<Response> {
  const { token } = await browserSessionToken();
  const env = parsePublicWebEnv(process.env);

  return mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": mutationIdempotencyKey()
    },
    method
  });
}

async function mutationFetch(input: URL, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiMutationError("API is unavailable", 503);
  }
}

async function browserSessionToken() {
  const walletToken = getWalletSessionToken();
  if (walletToken) {
    return { token: walletToken };
  }

  const e2eToken = browserE2eAccessToken();
  if (e2eToken) {
    return { token: e2eToken };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new ApiMutationError("Create or restore a session before continuing.", 401);
  }

  return { token: session.access_token };
}

function browserE2eAccessToken() {
  if (!browserE2eAuthEnabled) {
    return null;
  }

  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${e2eAuthCookieName}=`))
    ?.slice(e2eAuthCookieName.length + 1);

  return token ? decodeURIComponent(token) : null;
}

function mutationIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.code === "string" && body.code) return body.code;
  } catch {
    return response.statusText || "Request failed";
  }

  return response.statusText || "Request failed";
}
