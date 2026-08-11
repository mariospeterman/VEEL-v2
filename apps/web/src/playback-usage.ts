"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "@veel/contracts";
import { authenticatedMutation, createMutationIdempotencyKey } from "./api-mutation-transport";

type PlaybackUsageContext = components["schemas"]["PlaybackUsageContext"];
type PlaybackUsageSession = components["schemas"]["PlatformPlaybackSession"];

export function usePlaybackUsage(usage: PlaybackUsageContext | null | undefined) {
  const [exhausted, setExhausted] = useState(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef<PlaybackUsageSession | null>(null);
  const sessionPromiseRef = useRef<Promise<PlaybackUsageSession> | null>(null);
  const sessionIdempotencyKeyRef = useRef(createMutationIdempotencyKey());
  const sequenceRef = useRef(0);
  const unreportedSecondsRef = useRef(0);
  const playingRef = useRef(false);
  const sendingRef = useRef(false);

  const ensureSession = useCallback(async () => {
    if (!usage) return null;
    if (sessionRef.current) return sessionRef.current;
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = authenticatedMutation<PlaybackUsageSession>(
        "/v1/platform-usage/playback-sessions",
        "POST",
        { targetType: usage.targetType, targetId: usage.targetId },
        sessionIdempotencyKeyRef.current
      ).then((session) => {
        sessionRef.current = session;
        if (mountedRef.current) {
          setExhausted(session.state === "exhausted" || session.usage.limitReached);
        }
        return session;
      }).finally(() => {
        sessionPromiseRef.current = null;
      });
    }
    return sessionPromiseRef.current;
  }, [usage]);

  const flush = useCallback(async () => {
    if (!usage || sendingRef.current || unreportedSecondsRef.current < 1) return;
    sendingRef.current = true;
    const playedSeconds = Math.min(30, unreportedSecondsRef.current);

    try {
      const session = await ensureSession();
      if (!session || session.state !== "active") return;
      const sequence = sequenceRef.current + 1;
      const updated = await authenticatedMutation<PlaybackUsageSession>(
        `/v1/platform-usage/playback-sessions/${encodeURIComponent(session.id)}/heartbeats`,
        "POST",
        { sequence, playedSeconds },
        `${session.id}:${sequence}`
      );
      sequenceRef.current = sequence;
      unreportedSecondsRef.current = Math.max(0, unreportedSecondsRef.current - playedSeconds);
      sessionRef.current = updated;
      if (mountedRef.current) {
        setExhausted(updated.state === "exhausted" || updated.usage.limitReached);
      }
    } catch {
      // Keep the unreported interval for the next idempotent retry.
    } finally {
      sendingRef.current = false;
    }
  }, [ensureSession, usage]);

  const setPlaying = useCallback((playing: boolean) => {
    playingRef.current = playing;
    if (playing) {
      void ensureSession();
    } else {
      void flush();
    }
  }, [ensureSession, flush]);

  useEffect(() => {
    if (!usage || exhausted) return;
    const timer = window.setInterval(() => {
      if (!playingRef.current || document.visibilityState !== "visible") return;
      unreportedSecondsRef.current += 1;
      if (unreportedSecondsRef.current >= usage.heartbeatIntervalSeconds) {
        void flush();
      }
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [exhausted, flush, usage]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => () => {
    playingRef.current = false;
    void flush();
  }, [flush]);

  return { exhausted, setPlaying };
}
