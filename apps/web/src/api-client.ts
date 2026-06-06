import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config";
import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type CreatorDashboard = components["schemas"]["CreatorMonetisationDashboard"];
export type CreatorProfile = components["schemas"]["CreatorProfile"];
export type LiveRoom = components["schemas"]["LiveRoom"];
export type ActivityItem = components["schemas"]["ActivityItem"];
export type ActivityPage = components["schemas"]["ActivityPage"];
export type WalletTransaction = components["schemas"]["WalletTransaction"];
export type WalletTransactionPage = components["schemas"]["WalletTransactionPage"];
export type Conversation = components["schemas"]["Conversation"];
export type ConversationList = {
  items: Conversation[];
};
export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];
export type Wallet = components["schemas"]["Wallet"];
export type WalletList = {
  items: Wallet[];
};

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

export async function getCreatorProfile(handle: string): Promise<ApiResult<CreatorProfile>> {
  return getJson<CreatorProfile>(`/v1/profiles/${encodeURIComponent(handle)}`);
}

export async function getMyCreatorDashboard(): Promise<ApiResult<CreatorDashboard>> {
  return getJson<CreatorDashboard>("/v1/profiles/me/creator-dashboard");
}

export async function getPaymentActivity(): Promise<ApiResult<ActivityPage>> {
  return getJson<ActivityPage>("/v1/activity/payments");
}

export async function getWalletTransactionActivity(): Promise<ApiResult<WalletTransactionPage>> {
  return getJson<WalletTransactionPage>("/v1/activity/wallet-transactions");
}

export async function getConversations(): Promise<ApiResult<ConversationList>> {
  return getJson<ConversationList>("/v1/messages/conversations");
}

export async function getConversationMessages(conversationId: string): Promise<ApiResult<MessagePage>> {
  return getJson<MessagePage>(`/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export async function getWallets(): Promise<ApiResult<WalletList>> {
  return getJson<WalletList>("/v1/wallets");
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
