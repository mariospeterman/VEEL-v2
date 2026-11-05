"use client";

import { useEffect, useRef, useState } from "react";
import type { Src } from "@livepeer/react";
import * as Player from "@livepeer/react/player";
import type { ContentItem, LiveRoom } from "@/api-client";
import { playbackLeaseAction, usePlaybackUsage } from "@/playback-usage";

type Playback = NonNullable<ContentItem["playback"] | LiveRoom["playback"]>;
type PlayerJsInstance = InstanceType<(typeof import("player.js"))["default"]["Player"]>;

export function ProviderPlayback({
  onLeaseStarted,
  playback,
  posterUrl,
  resourceKey,
  title
}: {
  onLeaseStarted?: (() => Promise<unknown>) | undefined;
  playback: Playback | null | undefined;
  posterUrl?: string | null | undefined;
  resourceKey: string;
  title: string;
}) {
  return (
    <ProviderPlaybackResource
      key={resourceKey}
      onLeaseStarted={onLeaseStarted}
      playback={playback}
      posterUrl={posterUrl}
      title={title}
    />
  );
}

function ProviderPlaybackResource({
  onLeaseStarted,
  playback,
  posterUrl,
  title
}: {
  onLeaseStarted?: (() => Promise<unknown>) | undefined;
  playback: Playback | null | undefined;
  posterUrl?: string | null | undefined;
  title: string;
}) {
  const [resourceExpired, setResourceExpired] = useState(
    Boolean(playback?.expiresAt && Date.parse(playback.expiresAt) <= Date.now())
  );
  const [leaseStarting, setLeaseStarting] = useState(false);
  const [leaseStartFailed, setLeaseStartFailed] = useState(false);
  const usage = usePlaybackUsage(playback?.usage);

  useEffect(() => {
    if (!playback?.expiresAt) {
      setResourceExpired(false);
      return;
    }
    const delay = Math.max(0, Date.parse(playback.expiresAt) - Date.now());
    setResourceExpired(delay === 0);
    if (delay === 0) return;
    const timeout = window.setTimeout(() => setResourceExpired(true), delay);
    return () => window.clearTimeout(timeout);
  }, [playback?.expiresAt, playback?.url]);

  async function startOrRenewLease() {
    if (!playback?.usage || leaseStarting) return;
    setLeaseStarting(true);
    setLeaseStartFailed(false);
    try {
      if (playbackLeaseAction(playback.usage) === "reserve") {
        const session = await usage.startLease();
        if (!session || session.state !== "active") throw new Error("PLAYBACK_LEASE_NOT_ACTIVE");
      }
      if (onLeaseStarted) {
        await onLeaseStarted();
        setLeaseStarting(false);
      } else {
        window.location.reload();
      }
    } catch {
      setLeaseStartFailed(true);
      setLeaseStarting(false);
    }
  }

  if (usage.exhausted) {
    return <ProviderPlaceholder state="blocked" message="Your public-media allowance is used for this month." />;
  }

  if (resourceExpired || playback?.state !== "full" || !playback.url) {
    return (
      <ProviderPlaceholder
        action={playback?.usage
          ? {
              disabled: leaseStarting,
              label: leaseStarting ? "Starting…" : resourceExpired ? "Renew playback" : "Start playback",
              onClick: () => { void startOrRenewLease(); }
            }
          : undefined}
        state={playback?.state ?? "not_ready"}
        message={leaseStartFailed
          ? "Playback could not be started. Try again."
          : playback?.blockReason === "allowance_exhausted"
          ? "Your public-media allowance is used for this month."
          : playback?.usage
            ? "Starting playback reserves a short, backend-accounted viewing lease."
          : undefined}
      />
    );
  }

  if (playback.provider === "bunny") {
    if (playback.resourceType === "embed") {
      return <BunnyEmbedPlayer onPlayingChange={usage.setPlaying} src={playback.url} title={title} />;
    }

    return (
      <ProviderPlaceholder
        state="not_ready"
        message="This video is not ready to play yet. Try again in a moment."
      />
    );
  }

  if (playback.provider === "livepeer") {
    return (
      <LivepeerOfficialPlayer
        jwt={playback.jwt}
        onPlayingChange={usage.setPlaying}
        posterUrl={posterUrl}
        resourceType={playback.resourceType}
        src={playback.url}
        title={title}
      />
    );
  }

  return <ProviderPlaceholder state="not_ready" />;
}

export function BunnyEmbedPlayer({
  onPlayingChange,
  src,
  title
}: {
  onPlayingChange: (playing: boolean) => void;
  src: string;
  title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let disposed = false;
    let player: PlayerJsInstance | null = null;
    const onPlay = () => onPlayingChange(true);
    const onStop = () => onPlayingChange(false);

    void import("player.js").then(({ default: PlayerJs }) => {
      if (disposed) return;
      player = new PlayerJs.Player(frame);
      player.on("play", onPlay);
      player.on("pause", onStop);
      player.on("ended", onStop);
      player.on("error", onStop);
    });

    return () => {
      disposed = true;
      onPlayingChange(false);
      player?.off("play", onPlay);
      player?.off("pause", onStop);
      player?.off("ended", onStop);
      player?.off("error", onStop);
    };
  }, [onPlayingChange]);

  return (
    <iframe
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className="provider-frame"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      ref={frameRef}
      sandbox="allow-scripts allow-same-origin allow-presentation"
      src={src}
      title={title}
    />
  );
}

export function LivepeerOfficialPlayer({
  jwt,
  onPlayingChange,
  posterUrl,
  resourceType,
  src,
  title
}: {
  jwt?: string | null | undefined;
  onPlayingChange: (playing: boolean) => void;
  posterUrl?: string | null | undefined;
  resourceType: Playback["resourceType"];
  src: string;
  title: string;
}) {
  const source = toLivepeerSrc(src, resourceType);

  return (
    <Player.Root src={source} aspectRatio={null} jwt={jwt ?? null}>
      <Player.Container className="absolute inset-0 h-full w-full overflow-hidden bg-black">
        <Player.Video
          className="h-full w-full object-contain"
          onEnded={() => onPlayingChange(false)}
          onError={() => onPlayingChange(false)}
          onPause={() => onPlayingChange(false)}
          onPlay={() => onPlayingChange(true)}
          onPlaying={() => onPlayingChange(true)}
          onStalled={() => onPlayingChange(false)}
          onWaiting={() => onPlayingChange(false)}
          poster={posterUrl ?? null}
          title={title}
        />
        <Player.Controls className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 text-white">
          <Player.PlayPauseTrigger aria-label="Play or pause" className="min-h-10 min-w-14 rounded bg-black/60 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            <Player.PlayingIndicator matcher={false}>Play</Player.PlayingIndicator>
            <Player.PlayingIndicator matcher>Pause</Player.PlayingIndicator>
          </Player.PlayPauseTrigger>
          <Player.MuteTrigger aria-label="Mute or unmute" className="min-h-10 rounded bg-black/60 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            Sound
          </Player.MuteTrigger>
          <Player.LiveIndicator className="min-h-10 rounded bg-red-600 px-3 text-xs font-semibold uppercase">
            Live
          </Player.LiveIndicator>
          <span className="flex-1" />
          <Player.FullscreenTrigger aria-label="Enter or leave fullscreen" className="min-h-10 rounded bg-black/60 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            Fullscreen
          </Player.FullscreenTrigger>
        </Player.Controls>
        <Player.LoadingIndicator className="provider-placeholder data-[visible=false]:hidden">
          <div>
            <p className="text-sm font-semibold">Loading video</p>
            <p className="mt-2 text-xs leading-5 text-zinc-200">This can take a moment when a live is starting.</p>
          </div>
        </Player.LoadingIndicator>
        <Player.ErrorIndicator matcher="all" className="provider-placeholder data-[visible=false]:hidden">
          <div>
            <p className="text-sm font-semibold">Video unavailable</p>
            <p className="mt-2 text-xs leading-5 text-zinc-200">Refresh the page or try again in a moment.</p>
          </div>
        </Player.ErrorIndicator>
      </Player.Container>
    </Player.Root>
  );
}

function ProviderPlaceholder({
  action,
  message,
  state
}: {
  action?: { disabled: boolean; label: string; onClick: () => void } | undefined;
  message?: string | undefined;
  state: Playback["state"];
}) {
  return (
    <div className="provider-placeholder">
      <div>
        <p className="text-sm font-semibold">{playbackStateLabel(state)}</p>
        <p className="mt-2 text-xs leading-5 text-zinc-200">
          {message ?? "Refresh the page or try again in a moment."}
        </p>
        {action ? (
          <button
            className="mt-4 min-h-11 rounded bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
            disabled={action.disabled}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function toLivepeerSrc(url: string, resourceType: Playback["resourceType"]): Src[] {
  if (resourceType === "hls" || url.includes(".m3u8")) {
    return [
      {
        height: null,
        mime: "application/vnd.apple.mpegurl",
        src: url as `${string}m3u8${"" | `?${string}`}`,
        type: "hls",
        width: null
      }
    ];
  }

  return [
    {
      height: null,
      mime: null,
      src: url,
      type: "video",
      width: null
    }
  ];
}

function playbackStateLabel(state: Playback["state"]) {
  if (state === "blocked") return "Access required";
  if (state === "teaser") return "Teaser preview";
  if (state === "full") return "Ready to watch";
  return "Video not ready";
}
