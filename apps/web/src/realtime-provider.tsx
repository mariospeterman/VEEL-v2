"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createRealtimeAccessToken, recordRealtimeConnectionEvent } from "@/api-mutations";
import { createSupabaseRealtimeClient } from "@/supabase/client";

type RealtimeClient = ReturnType<typeof createSupabaseRealtimeClient>;
type TopicKind = "account" | "conversation" | "live";

interface InvalidationPayload {
  event: string;
  resourceKind: string;
  resourceId: string;
  version: number;
}

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const versions = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeClient: RealtimeClient | null = null;
    let activeChannel: ReturnType<RealtimeClient["channel"]> | null = null;
    let attempt = 0;
    let tokenCache: { token: string; expiresAtMs: number; accountTopic: string } | null = null;

    const issueToken = async () => {
      if (tokenCache && tokenCache.expiresAtMs - Date.now() > 30_000) return tokenCache;
      const issued = await createRealtimeAccessToken();
      tokenCache = {
        token: issued.token,
        expiresAtMs: Date.parse(issued.expiresAt),
        accountTopic: issued.accountTopic
      };
      return tokenCache;
    };

    const record = (state: "connected" | "reconnecting" | "failed" | "disconnected", reasonCode: "subscribed" | "channel_error" | "timed_out" | "closed" | "token_unavailable" | "cleanup") => {
      void recordRealtimeConnectionEvent({
        topicKind: "account",
        state,
        reasonCode,
        attempt,
        occurredAt: new Date().toISOString()
      }).catch(() => undefined);
    };

    const cleanupClient = () => {
      if (activeChannel) void activeClient?.removeChannel(activeChannel);
      activeChannel = null;
      activeClient = null;
      setClient(null);
    };

    const schedule = () => {
      if (cancelled || retryTimer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt = Math.min(attempt + 1, 10);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      cleanupClient();
      try {
        const issued = await issueToken();
        if (cancelled) return;
        activeClient = createSupabaseRealtimeClient(async () => (await issueToken()).token);
        await activeClient.realtime.setAuth(issued.token);
        setClient(activeClient);
        activeChannel = activeClient.channel(issued.accountTopic, { config: { private: true } });
        activeChannel.on("broadcast", { event: "projection_changed" }, ({ payload }) => {
          const invalidation = parseInvalidation(payload);
          if (!invalidation || !acceptVersion(versions.current, issued.accountTopic, invalidation.version)) return;
          invalidateAccountProjection(queryClient, invalidation);
        });
        activeChannel.subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            attempt = 0;
            record("connected", "subscribed");
            void queryClient.invalidateQueries({ queryKey: ["notifications"] });
            void queryClient.invalidateQueries({ queryKey: ["messages"] });
            void queryClient.invalidateQueries({ queryKey: ["activity"] });
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
              tokenCache = null;
              void issueToken().then((next) => activeClient?.realtime.setAuth(next.token)).catch(() => {
                record("failed", "token_unavailable");
                schedule();
              });
            }, Math.max(5_000, issued.expiresAtMs - Date.now() - 30_000));
            return;
          }
          const reason = status === "CHANNEL_ERROR" ? "channel_error" : status === "TIMED_OUT" ? "timed_out" : "closed";
          record(status === "CLOSED" ? "disconnected" : "reconnecting", reason);
          schedule();
        });
      } catch {
        tokenCache = null;
        record("failed", "token_unavailable");
        schedule();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      record("disconnected", "cleanup");
      cleanupClient();
    };
  }, [queryClient]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useScopedRealtimeInvalidation(input: {
  topic: string | null;
  topicKind: Exclude<TopicKind, "account">;
  queryKeys: QueryKey[];
}) {
  const client = useContext(RealtimeContext);
  const queryClient = useQueryClient();
  const versions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!client || !input.topic) return;
    const topic = input.topic;
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "projection_changed" }, ({ payload }) => {
      const invalidation = parseInvalidation(payload);
      if (!invalidation || !acceptVersion(versions.current, topic, invalidation.version)) return;
      for (const queryKey of input.queryKeys) void queryClient.invalidateQueries({ queryKey });
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        for (const queryKey of input.queryKeys) void queryClient.invalidateQueries({ queryKey });
      }
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        void recordRealtimeConnectionEvent({
          topicKind: input.topicKind,
          state: status === "SUBSCRIBED" ? "connected" : status === "CLOSED" ? "disconnected" : "reconnecting",
          reasonCode: status === "SUBSCRIBED" ? "subscribed" : status === "CHANNEL_ERROR" ? "channel_error" : status === "TIMED_OUT" ? "timed_out" : "closed",
          attempt: 0,
          occurredAt: new Date().toISOString()
        }).catch(() => undefined);
      }
    });
    return () => { void client.removeChannel(channel); };
  }, [client, input.queryKeys, input.topic, input.topicKind, queryClient]);
}

function parseInvalidation(value: unknown): InvalidationPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<InvalidationPayload>;
  return typeof payload.event === "string" &&
    typeof payload.resourceKind === "string" &&
    typeof payload.resourceId === "string" &&
    Number.isSafeInteger(payload.version) && (payload.version ?? 0) > 0
    ? payload as InvalidationPayload
    : null;
}

function acceptVersion(versions: Map<string, number>, topic: string, version: number) {
  if (version <= (versions.get(topic) ?? 0)) return false;
  versions.set(topic, version);
  return true;
}

function invalidateAccountProjection(
  queryClient: ReturnType<typeof useQueryClient>,
  payload: InvalidationPayload
) {
  if (["messages", "conversation_members", "direct_message_requests", "message_reactions", "creator_media_offers", "structured_creator_requests", "conversation"].includes(payload.resourceKind)) {
    void queryClient.invalidateQueries({ queryKey: ["messages"] });
  } else if (payload.resourceKind === "notifications") {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  } else if (payload.resourceKind === "live_room") {
    void queryClient.invalidateQueries({ queryKey: ["live"] });
  }
}
