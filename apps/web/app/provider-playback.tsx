"use client";

import { useEffect, useRef } from "react";
import type { Src } from "@livepeer/react";
import * as Player from "@livepeer/react/player";
import playerjs from "player.js";
import type { ContentItem, LiveRoom } from "@/api-client";
import { usePlaybackUsage } from "@/playback-usage";

type Playback = NonNullable<ContentItem["playback"] | LiveRoom["playback"]>;

export function ProviderPlayback({
  playback,
  posterUrl,
  title
}: {
  playback: Playback | null | undefined;
  posterUrl?: string | null | undefined;
  title: string;
}) {
  const playbackKey = playback?.usage
    ? `${playback.usage.targetType}:${playback.usage.targetId}`
    : `${playback?.provider ?? "none"}:${playback?.url ?? playback?.state ?? "missing"}`;

  return (
    <ProviderPlaybackResource
      key={playbackKey}
      playback={playback}
      posterUrl={posterUrl}
      title={title}
    />
  );
}

function ProviderPlaybackResource({
  playback,
  posterUrl,
  title
}: {
  playback: Playback | null | undefined;
  posterUrl?: string | null | undefined;
  title: string;
}) {
  const usage = usePlaybackUsage(playback?.usage);

  if (usage.exhausted) {
    return <ProviderPlaceholder state="blocked" message="Your public-media allowance is used for this month." />;
  }

  if (playback?.state !== "full" || !playback.url) {
    return (
      <ProviderPlaceholder
        state={playback?.state ?? "not_ready"}
        message={playback?.blockReason === "allowance_exhausted"
          ? "Your public-media allowance is used for this month."
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
        message="Bunny playback requires a backend-issued Bunny Stream embed URL."
      />
    );
  }

  if (playback.provider === "livepeer") {
    return (
      <LivepeerOfficialPlayer
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
    const player = new playerjs.Player(frame);
    const onPlay = () => onPlayingChange(true);
    const onStop = () => onPlayingChange(false);
    player.on("play", onPlay);
    player.on("pause", onStop);
    player.on("ended", onStop);
    player.on("error", onStop);

    return () => {
      onPlayingChange(false);
      player.off("play", onPlay);
      player.off("pause", onStop);
      player.off("ended", onStop);
      player.off("error", onStop);
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
  onPlayingChange,
  posterUrl,
  resourceType,
  src,
  title
}: {
  onPlayingChange: (playing: boolean) => void;
  posterUrl?: string | null | undefined;
  resourceType: Playback["resourceType"];
  src: string;
  title: string;
}) {
  const source = toLivepeerSrc(src, resourceType);

  return (
    <Player.Root src={source} aspectRatio={null}>
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
        <Player.LoadingIndicator className="provider-placeholder data-[visible=false]:hidden">
          <div>
            <p className="text-sm font-semibold">Loading Livepeer playback</p>
            <p className="mt-2 text-xs leading-5 text-zinc-200">
              Playback is rendered through the official Livepeer React player.
            </p>
          </div>
        </Player.LoadingIndicator>
        <Player.ErrorIndicator matcher="all" className="provider-placeholder data-[visible=false]:hidden">
          <div>
            <p className="text-sm font-semibold">Livepeer playback unavailable</p>
            <p className="mt-2 text-xs leading-5 text-zinc-200">
              The backend playback projection is present, but the provider player could not render it.
            </p>
          </div>
        </Player.ErrorIndicator>
      </Player.Container>
    </Player.Root>
  );
}

function ProviderPlaceholder({
  message,
  state
}: {
  message?: string | undefined;
  state: Playback["state"];
}) {
  return (
    <div className="provider-placeholder">
      <div>
        <p className="text-sm font-semibold">{playbackStateLabel(state)}</p>
        <p className="mt-2 text-xs leading-5 text-zinc-200">
          {message ?? "Playback is rendered only from backend-issued access projection."}
        </p>
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
  if (state === "full") return "Playback ready";
  return "Playback not ready";
}
