import { cookies } from "next/headers";
import { parsePublicWebEnv } from "@veel/config/public";
import { getE2eAccessToken } from "./supabase/e2e-auth";
import type { ApiResult } from "./api-client-types";

const apiFetchTimeoutMs = 2_500;

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const { token, cookie } = await getApplicationSessionTransport();
  const headers = new Headers({ accept: "application/json" });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (cookie) headers.set("cookie", cookie);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(apiFetchTimeoutMs)
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: await getErrorMessage(response)
      };
    }

    return {
      ok: true,
      data: (await response.json()) as T
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "API is unavailable"
    };
  }
}

export async function getApplicationSessionTransport() {
  const cookieStore = await cookies();
  const walletToken = cookieStore.get("wevid_session")?.value;
  if (walletToken) {
    return {
      token: null,
      cookie: `wevid_session=${encodeURIComponent(walletToken)}`
    };
  }

  const e2eAccessToken = await getE2eAccessToken();
  if (e2eAccessToken) {
    return { token: e2eAccessToken, cookie: null };
  }
  return { token: null, cookie: null };
}

export async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
    if (typeof body.code === "string" && body.code.length > 0) {
      return body.code;
    }
  } catch {
    return response.statusText || "Request failed";
  }

  return response.statusText || "Request failed";
}

export async function patchJson<T>(path: string, body: unknown, idempotencyKey: string): Promise<ApiResult<T>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const { token, cookie } = await getApplicationSessionTransport();
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey
  });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (cookie) headers.set("cookie", cookie);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers,
      method: "PATCH",
      signal: AbortSignal.timeout(apiFetchTimeoutMs)
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: await getErrorMessage(response)
      };
    }

    return {
      ok: true,
      data: (await response.json()) as T
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "API is unavailable"
    };
  }
}

export async function postEmpty(
  path: string,
  body: unknown,
  idempotencyKey: string
): Promise<ApiResult<null>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const { token, cookie } = await getApplicationSessionTransport();
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (cookie) headers.set("cookie", cookie);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers,
      method: "POST",
      signal: AbortSignal.timeout(apiFetchTimeoutMs)
    });
    if (!response.ok) {
      return { ok: false, status: response.status, message: await getErrorMessage(response) };
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, status: 503, message: "API is unavailable" };
  }
}
