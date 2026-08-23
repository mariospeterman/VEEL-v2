"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createRealtimeAccessToken, recordRealtimeConnectionEvent } from "@/api-mutations";
import {
  acceptRealtimeVersion,
  parseRealtimeInvalidation,
  shouldRecoverRealtimeGap,
  type RealtimeInvalidation
} from "@/realtime-protocol";
import { createSupabaseRealtimeClient } from "@/supabase/client";

type RealtimeClient = ReturnType<typeof createSupabaseRealtimeClient>;
type TopicKind = "account" | "conversation" | "live";

interface RealtimeContextValue {
  client: RealtimeClient;
  userId: string;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<RealtimeContextValue | null>(null);
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
      setConnection(null);
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
        setConnection({ client: activeClient, userId: issued.accountTopic.slice("account:".length) });
        activeChannel = activeClient.channel(issued.accountTopic, { config: { private: true } });
        activeChannel.on("broadcast", { event: "projection_changed" }, ({ payload }) => {
          const invalidation = parseRealtimeInvalidation(payload);
          if (!invalidation || !acceptRealtimeVersion(versions.current, issued.accountTopic, invalidation.version)) return;
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

  return <RealtimeContext.Provider value={connection}>{children}</RealtimeContext.Provider>;
}

export function useScopedRealtimeInvalidation(input: {
  topic: string | null;
  topicKind: Exclude<TopicKind, "account">;
  queryKeys: QueryKey[];
}) {
  const client = useContext(RealtimeContext)?.client ?? null;
  const queryClient = useQueryClient();
  const versions = useRef(new Map<string, number>());

  useEffect(() => {
    if (!client || !input.topic) return;
    const topic = input.topic;
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "projection_changed" }, ({ payload }) => {
      const invalidation = parseRealtimeInvalidation(payload);
      if (!invalidation || !acceptRealtimeVersion(versions.current, topic, invalidation.version)) return;
      for (const queryKey of input.queryKeys) void queryClient.invalidateQueries({ queryKey });
    });
    channel.subscribe((status) => {
      if (shouldRecoverRealtimeGap(status)) {
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

export function useConversationEphemeral(topic: string | null) {
  const realtime = useContext(RealtimeContext);
  const client = realtime?.client ?? null;
  const userId = realtime?.userId ?? null;
  const channelRef = useRef<ReturnType<RealtimeClient["channel"]> | null>(null);
  const lastTypingAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);

  useEffect(() => {
    if (!client || !topic || !userId) return;
    const channel = client.channel(topic, {
      config: { private: true, broadcast: { self: false }, presence: { key: userId } }
    });
    channelRef.current = channel;
    channel.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as { active?: unknown; expiresAt?: unknown };
      if (typeof value.active !== "boolean" || typeof value.expiresAt !== "number" || value.expiresAt < Date.now()) return;
      setPeerTyping(value.active);
      if (value.active) setTimeout(() => setPeerTyping(false), Math.min(3_000, value.expiresAt - Date.now()));
    });
    channel.on("presence", { event: "sync" }, () => {
      setPeerOnline(Object.keys(channel.presenceState()).length > 1);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ onlineAt: new Date().toISOString() });
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPeerOnline(false);
        setPeerTyping(false);
      }
    });
    return () => {
      channelRef.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      void client.removeChannel(channel);
    };
  }, [client, topic, userId]);

  const sendTyping = useCallback((active: boolean) => {
    const channel = channelRef.current;
    if (!channel) return;
    const now = Date.now();
    if (active && now - lastTypingAt.current < 1_500) return;
    lastTypingAt.current = now;
    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { active, expiresAt: active ? now + 2_500 : now + 500 }
    });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (active) typingTimer.current = setTimeout(() => sendTyping(false), 2_000);
  }, []);

  return { peerTyping, peerOnline, sendTyping };
}

function invalidateAccountProjection(
  queryClient: ReturnType<typeof useQueryClient>,
  payload: RealtimeInvalidation
) {
  if (["messages", "conversation_members", "direct_message_requests", "message_reactions", "message_attachments", "creator_media_offers", "structured_creator_requests", "conversation"].includes(payload.resourceKind)) {
    void queryClient.invalidateQueries({ queryKey: ["messages"] });
  } else if (payload.resourceKind === "notifications") {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  } else if (payload.resourceKind === "live_room") {
    void queryClient.invalidateQueries({ queryKey: ["live"] });
  }
}
