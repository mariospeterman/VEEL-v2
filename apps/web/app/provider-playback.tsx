"use client";

import type { Src } from "@livepeer/react";
import * as Player from "@livepeer/react/player";
import type { ContentItem, LiveRoom } from "@/api-client";

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
  if (playback?.state !== "full" || !playback.url) {
    return <ProviderPlaceholder state={playback?.state ?? "not_ready"} />;
  }

  if (playback.provider === "bunny") {
    if (playback.resourceType === "embed") {
      return <BunnyEmbedPlayer src={playback.url} title={title} />;
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
        posterUrl={posterUrl}
        resourceType={playback.resourceType}
        src={playback.url}
        title={title}
      />
    );
  }

  return <ProviderPlaceholder state="not_ready" />;
}

export function BunnyEmbedPlayer({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className="provider-frame"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      src={src}
      title={title}
    />
  );
}

export function LivepeerOfficialPlayer({
  posterUrl,
  resourceType,
  src,
  title
}: {
  posterUrl?: string | null | undefined;
  resourceType: Playback["resourceType"];
  src: string;
  title: string;
}) {
  const source = toLivepeerSrc(src, resourceType);

  return (
    <Player.Root src={source} aspectRatio={null}>
      <Player.Container className="absolute inset-0 h-full w-full overflow-hidden bg-black">
        <Player.Video className="h-full w-full object-contain" poster={posterUrl ?? null} title={title} />
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
  message?: string;
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
