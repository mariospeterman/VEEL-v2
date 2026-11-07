"use client";

import * as Broadcast from "@livepeer/react/broadcast";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  browserBroadcastErrorMessage,
  livepeerWhipIngestUrl,
  releaseBroadcastMedia,
  releaseMediaSource
} from "./livepeer-browser-broadcast-utils";

interface LivepeerBrowserBroadcastProps {
  onStopped: () => void;
  streamKey: string;
}

export function LivepeerBrowserBroadcast({
  onStopped,
  streamKey
}: LivepeerBrowserBroadcastProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaSourceRef = useRef<unknown>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ingestUrl = useMemo(() => livepeerWhipIngestUrl(streamKey), [streamKey]);

  useEffect(() => () => {
    releaseMediaSource(mediaSourceRef.current, videoRef.current?.srcObject);
    releaseBroadcastMedia(videoRef.current);
    mediaSourceRef.current = null;
  }, []);

  function stopAndClose() {
    releaseMediaSource(mediaSourceRef.current, videoRef.current?.srcObject);
    releaseBroadcastMedia(videoRef.current);
    mediaSourceRef.current = null;
    onStopped();
  }

  if (!ingestUrl) {
    return (
      <div className="grid gap-3 rounded border border-red-500/40 bg-red-500/10 p-4" role="alert">
        <p className="text-sm text-red-200">The browser live connection is unavailable. Close this preview and try again.</p>
        <button className="secondary-button justify-self-start" onClick={stopAndClose} type="button">
          Close preview
        </button>
      </div>
    );
  }

  return (
    <Broadcast.Root
      aspectRatio={16 / 9}
      audio
      hotkeys={false}
      ingestUrl={ingestUrl}
      onError={(broadcastError) => {
        setError(broadcastError ? browserBroadcastErrorMessage(broadcastError.type) : null);
        if (broadcastError?.type === "permissions") setPreviewReady(false);
      }}
      storage={null}
      video={{
        facingMode: { ideal: "user" },
        height: { ideal: 720 },
        width: { ideal: 1280 }
      }}
    >
      <div className="grid gap-4">
        <Broadcast.Container className="relative overflow-hidden rounded-xl border border-(--line) bg-black">
          <Broadcast.Video
            autoPlay
            className="h-full w-full object-cover"
            muted
            onLoadedMetadata={() => {
              const nextSource = videoRef.current?.srcObject ?? null;
              releaseMediaSource(mediaSourceRef.current, nextSource);
              mediaSourceRef.current = nextSource;
              setPreviewReady(true);
              setError(null);
            }}
            playsInline
            ref={videoRef}
          />
          <div className="pointer-events-none absolute left-3 top-3" aria-live="polite">
            <Broadcast.StatusIndicator className="rounded-full bg-black/75 px-3 py-1 text-xs font-semibold text-white" matcher="idle">
              {previewReady ? "Preview ready" : "Opening camera…"}
            </Broadcast.StatusIndicator>
            <Broadcast.StatusIndicator className="rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-black" matcher="pending">
              Connecting…
            </Broadcast.StatusIndicator>
            <Broadcast.StatusIndicator className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white" matcher="live">
              Live
            </Broadcast.StatusIndicator>
          </div>
        </Broadcast.Container>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeviceSelect label="Camera" type="videoinput" />
          <DeviceSelect label="Microphone" type="audioinput" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Broadcast.AudioEnabledTrigger className="min-h-11 rounded border border-(--line) px-4 py-2 text-sm font-semibold">
            <Broadcast.AudioEnabledIndicator matcher>Mute microphone</Broadcast.AudioEnabledIndicator>
            <Broadcast.AudioEnabledIndicator matcher={false}>Turn microphone on</Broadcast.AudioEnabledIndicator>
          </Broadcast.AudioEnabledTrigger>
          <Broadcast.VideoEnabledTrigger className="min-h-11 rounded border border-(--line) px-4 py-2 text-sm font-semibold">
            <Broadcast.VideoEnabledIndicator matcher>Turn camera off</Broadcast.VideoEnabledIndicator>
            <Broadcast.VideoEnabledIndicator matcher={false}>Turn camera on</Broadcast.VideoEnabledIndicator>
          </Broadcast.VideoEnabledTrigger>
          <Broadcast.EnabledTrigger
            className="min-h-11 rounded bg-(--foreground) px-5 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!previewReady}
            onClick={(event) => {
              if (event.currentTarget.getAttribute("aria-pressed") === "true") {
                stopAndClose();
              }
            }}
          >
            <Broadcast.EnabledIndicator matcher={false}>Start live</Broadcast.EnabledIndicator>
            <Broadcast.EnabledIndicator matcher>Stop broadcast</Broadcast.EnabledIndicator>
          </Broadcast.EnabledTrigger>
          <button
            className="min-h-11 rounded border border-(--line) px-4 py-2 text-sm font-semibold"
            onClick={() => {
              if (window.confirm("Close the camera preview and stop sending from this device?")) {
                stopAndClose();
              }
            }}
            type="button"
          >
            Close camera
          </button>
        </div>

        <p className="text-xs leading-5 text-(--muted)">
          Start live only after the preview looks right. Stopping the browser broadcast closes this camera connection; use End live to close the room for viewers.
        </p>
        {error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</p> : null}
      </div>
    </Broadcast.Root>
  );
}

function DeviceSelect({
  label,
  type
}: {
  label: string;
  type: "audioinput" | "videoinput";
}) {
  const labelId = `broadcast-${type}-label`;
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-(--muted)" id={labelId}>{label}</span>
      <Broadcast.SourceSelect type={type}>
        {(devices) => (
          <>
            <Broadcast.SelectTrigger
              aria-labelledby={labelId}
              className="flex min-h-11 items-center justify-between gap-2 rounded border border-(--line) bg-(--background) px-3 text-left text-sm disabled:opacity-50"
            >
              <Broadcast.SelectValue placeholder={`Default ${label.toLowerCase()}`} />
              <Broadcast.SelectIcon aria-hidden="true">⌄</Broadcast.SelectIcon>
            </Broadcast.SelectTrigger>
            <Broadcast.SelectPortal>
              <Broadcast.SelectContent className="z-50 overflow-hidden rounded border border-(--line) bg-(--panel) p-1 shadow-xl" position="popper">
                <Broadcast.SelectViewport>
                  {devices?.map((device) => (
                    <Broadcast.SelectItem
                      className="cursor-pointer rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-(--accent-soft)"
                      key={`${device.kind}:${device.deviceId}`}
                      value={device.deviceId}
                    >
                      <Broadcast.SelectItemText>{device.friendlyName}</Broadcast.SelectItemText>
                    </Broadcast.SelectItem>
                  ))}
                </Broadcast.SelectViewport>
              </Broadcast.SelectContent>
            </Broadcast.SelectPortal>
          </>
        )}
      </Broadcast.SourceSelect>
    </div>
  );
}
