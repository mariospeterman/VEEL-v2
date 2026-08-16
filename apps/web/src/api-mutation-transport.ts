"use client";

import { readPublicWebEnv } from "@/public-env";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";
import { ApiMutationError } from "./api-mutation-types";

const browserE2eAuthEnabled =
  process.env.NEXT_PUBLIC_ENABLE_E2E_AUTH === "true";

export async function authenticatedGet<T>(path: string): Promise<T> {
  const { token } = await browserSessionToken();
  const env = readPublicWebEnv();
  const headers = new Headers({ accept: "application/json" });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    cache: "no-store",
    credentials: "include",
    headers
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function authenticatedMutation<T>(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
  idempotencyKey?: string
): Promise<T> {
  const response = await sendAuthenticatedMutation(path, method, body, idempotencyKey);

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function authenticatedEmptyMutation(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
  idempotencyKey?: string
): Promise<void> {
  const response = await sendAuthenticatedMutation(path, method, body, idempotencyKey);

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }
}

export async function publicMutation<T>(
  path: string,
  method: "POST",
  body: unknown
): Promise<T> {
  const env = readPublicWebEnv();
  const response = await mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": createMutationIdempotencyKey()
    },
    method
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

export async function publicCapabilityMutation<T>(url: string, body: unknown): Promise<T> {
  const capabilityUrl = new URL(url);
  const safeLocalhost =
    capabilityUrl.hostname === "localhost" || capabilityUrl.hostname === "127.0.0.1";
  if (capabilityUrl.protocol !== "https:" && !(safeLocalhost && capabilityUrl.protocol === "http:")) {
    throw new ApiMutationError("Wallet request is unavailable", 503);
  }

  const response = await mutationFetch(capabilityUrl, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function sendAuthenticatedMutation(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
  idempotencyKey?: string
): Promise<Response> {
  const { token } = await browserSessionToken();
  const env = readPublicWebEnv();
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey ?? createMutationIdempotencyKey()
  });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return mutationFetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
    headers,
    method
  });
}

async function mutationFetch(input: URL, init: RequestInit) {
  const headers = new Headers(init.headers);
  if (input.hostname.endsWith(".ngrok-free.app")) {
    headers.set("ngrok-skip-browser-warning", "true");
  }

  try {
    return await fetch(input, { ...init, headers });
  } catch {
    throw new ApiMutationError("API is unavailable", 503);
  }
}

async function browserSessionToken() {
  const e2eToken = browserE2eAccessToken();
  return { token: e2eToken };
}

function browserE2eAccessToken() {
  if (!browserE2eAuthEnabled) {
    return null;
  }

  return browserCookieToken(e2eAuthCookieName);
}

function browserCookieToken(name: string) {
  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  return token ? decodeURIComponent(token) : null;
}

export function createMutationIdempotencyKey() {
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
