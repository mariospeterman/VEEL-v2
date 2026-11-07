"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveRoom } from "@/api-client";
import { ApiMutationError, getLiveRoomForMutation } from "@/api-mutations";
import {
  coalesceContentAccessRefresh,
  createContentAccessRefreshGeneration,
  createContentAccessRetryScheduler,
  isAuthoritativeContentAccessDenial,
  playbackAccessSourceKey
} from "@/media/content-access-refresh";
import { ProviderPlayback } from "../../provider-playback";

export function RenewableLiveStage({ room }: { room: LiveRoom }) {
  const initialKey = playbackAccessSourceKey(`live:${room.id}`, room.playback);
  const [renewed, setRenewed] = useState<{ key: string; playback: LiveRoom["playback"] } | null>(null);
  const [unavailable, setUnavailable] = useState<{ key: string } | null>(null);
  const latestKey = useRef(initialKey);
  const refreshGeneration = useRef<ReturnType<typeof createContentAccessRefreshGeneration> | null>(null);
  refreshGeneration.current ??= createContentAccessRefreshGeneration(initialKey);
  refreshGeneration.current.advance(initialKey);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const retryScheduler = useRef<ReturnType<typeof createContentAccessRetryScheduler> | null>(null);
  retryScheduler.current ??= createContentAccessRetryScheduler();
  const playback = renewed?.key === initialKey ? renewed.playback : room.playback;

  useEffect(() => {
    latestKey.current = initialKey;
    setRenewed(null);
    setUnavailable(null);
    retryScheduler.current?.reset();
    return () => retryScheduler.current?.reset();
  }, [initialKey]);

  const refresh = useCallback(async () => {
    const requestKey = latestKey.current;
    const request = refreshGeneration.current!.capture(requestKey);
    try {
      const next = await coalesceContentAccessRefresh(
        requestKey,
        () => getLiveRoomForMutation(room.id)
      );
      if (!refreshGeneration.current!.isCurrent(request) || latestKey.current !== requestKey) return;
      const nextKey = playbackAccessSourceKey(`live:${room.id}`, next.playback);
      if (nextKey === requestKey) {
        retryScheduler.current?.schedule(() => { void refreshRef.current(); });
        return;
      }
      latestKey.current = nextKey;
      retryScheduler.current?.reset();
      setRenewed({ key: initialKey, playback: next.playback });
      setUnavailable(null);
    } catch (error) {
      if (!refreshGeneration.current!.isCurrent(request) || latestKey.current !== requestKey) return;
      const status = error instanceof ApiMutationError ? error.status : undefined;
      if (isAuthoritativeContentAccessDenial(status)) {
        retryScheduler.current?.reset();
        setUnavailable({ key: initialKey });
        return;
      }
      retryScheduler.current?.schedule(() => { void refreshRef.current(); });
    }
  }, [initialKey, room.id]);
  refreshRef.current = refresh;

  if (unavailable?.key === initialKey) {
    return (
      <div className="provider-placeholder">
        <div>
          <p className="text-sm font-semibold">Live playback unavailable</p>
          <p className="mt-2 text-xs leading-5 text-zinc-200">Your access changed or this live is no longer available.</p>
        </div>
      </div>
    );
  }

  return (
    <ProviderPlayback
      onAccessRefresh={refresh}
      playback={playback}
      resourceKey={`live-room:${room.id}`}
      title={`${room.title} live playback`}
    />
  );
}
