import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config/public";
import { getE2eAccessToken } from "./supabase/e2e-auth";
import type { ApiResult } from "./api-client-types";

const apiFetchTimeoutMs = 2_500;

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const token = await getSupabaseAccessToken(env);
  const headers = new Headers({ accept: "application/json" });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

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

export async function getSupabaseAccessToken(env: ReturnType<typeof parsePublicWebEnv>) {
  const cookieStore = await cookies();
  const walletToken = cookieStore.get("veel_wallet_session_token")?.value;
  if (walletToken) {
    return walletToken;
  }

  const e2eAccessToken = await getE2eAccessToken();
  if (e2eAccessToken) {
    return e2eAccessToken;
  }

  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return null;
  }

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Server Components cannot persist refreshed cookies. Auth-changing flows run client-side.
      }
    }
  });
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    return null;
  }

  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
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
  const token = await getSupabaseAccessToken(env);
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey
  });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

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
