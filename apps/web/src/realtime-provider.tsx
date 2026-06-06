"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/supabase/client";

const realtimeProjectionTables = ["notifications", "messages", "conversation_members"] as const;

export function RealtimeProvider() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;

    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

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

      void supabase.removeChannel(channel);
      channel = null;
    };

    const subscribe = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (cancelled || !session || channel) return;

      channel = supabase.channel("veel-account-projections");
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

      channel.subscribe();
    };

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        removeChannel();
        return;
      }

      void subscribe();
    });

    void subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      subscription.unsubscribe();
      removeChannel();
    };
  }, [queryClient, router]);

  return null;
}
