import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config";
import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type LiveRoom = components["schemas"]["LiveRoom"];

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

export async function getContentItem(contentId: string): Promise<ApiResult<ContentItem>> {
  return getJson<ContentItem>(`/v1/content/${encodeURIComponent(contentId)}`);
}

export async function getLiveRoom(liveRoomId: string): Promise<ApiResult<LiveRoom>> {
  return getJson<LiveRoom>(`/v1/live/rooms/${encodeURIComponent(liveRoomId)}`);
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
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
      headers
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

async function getSupabaseAccessToken(env: ReturnType<typeof parsePublicWebEnv>) {
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return null;
  }

  const cookieStore = await cookies();
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
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
}

async function getErrorMessage(response: Response) {
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
