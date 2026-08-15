"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createRealtimeAccessToken } from "@/api-mutations";
import { createSupabaseRealtimeClient } from "@/supabase/client";

const realtimeProjectionTables = [
  "notifications",
  "messages",
  "conversation_members",
  "direct_message_requests"
] as const;

export function RealtimeProvider() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let realtimeClient: ReturnType<typeof createSupabaseRealtimeClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createSupabaseRealtimeClient>["channel"]> | null = null;
    let cachedToken: { token: string; expiresAtMs: number } | null = null;

    const accessToken = async () => {
      if (cachedToken && cachedToken.expiresAtMs - Date.now() > 30_000) {
        return cachedToken.token;
      }

      const issued = await createRealtimeAccessToken();
      cachedToken = {
        token: issued.token,
        expiresAtMs: Date.parse(issued.expiresAt)
      };
      return issued.token;
    };

    const scheduleRefresh = () => {
      if (refreshTimer) return;

      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["messages"] });
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
        router.refresh();
      }, 250);
    };

    const removeChannel = () => {
      if (!channel) return;

      void realtimeClient?.removeChannel(channel);
      channel = null;
    };

    const scheduleSubscribe = () => {
      if (cancelled || retryTimer) return;
      const delayMs = Math.min(30_000, 1_000 * 2 ** retryAttempt);
      retryAttempt = Math.min(retryAttempt + 1, 5);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void subscribe();
      }, delayMs);
    };

    const subscribe = async () => {
      if (cancelled || channel) return;

      try {
        await accessToken();
        realtimeClient = createSupabaseRealtimeClient(accessToken);
      } catch {
        cachedToken = null;
        scheduleSubscribe();
        return;
      }

      if (cancelled || !realtimeClient) return;

      channel = realtimeClient.channel("veel-account-projections");
      for (const table of realtimeProjectionTables) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table
          },
          scheduleRefresh
        );
      }

      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          retryAttempt = 0;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          removeChannel();
          scheduleSubscribe();
        }
      });
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (retryTimer) clearTimeout(retryTimer);
      removeChannel();
      realtimeClient = null;
      cachedToken = null;
    };
  }, [queryClient, router]);

  return null;
}
