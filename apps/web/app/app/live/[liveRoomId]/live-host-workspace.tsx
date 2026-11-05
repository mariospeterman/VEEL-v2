"use client";

import { useEffect, useState } from "react";
import type { LiveRoom, RevealedHostConnection } from "@/api-mutations";
import {
  ApiMutationError,
  endLiveRoom,
  revealLiveHostConnection,
  syncLiveRoom
} from "@/api-mutations";
import { LivepeerBrowserBroadcast } from "./livepeer-browser-broadcast";
import {
  detectBrowserBroadcastSupport,
  type BrowserBroadcastSupport
} from "./livepeer-browser-broadcast-utils";

export function LiveHostWorkspace({ initialRoom }: { initialRoom: LiveRoom }) {
  const [room, setRoom] = useState(initialRoom);
  const [connection, setConnection] = useState<RevealedHostConnection | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [obsVisible, setObsVisible] = useState(false);
  const [support, setSupport] = useState<BrowserBroadcastSupport | null>(null);
  const [pending, setPending] = useState<"camera" | "obs" | "sync" | "end" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupport(detectBrowserBroadcastSupport());
  }, []);

  function clearHostCredential() {
    setCameraOpen(false);
    setObsVisible(false);
    setCopied(null);
    setConnection(null);
  }

  async function openCamera() {
    if (!support?.supported) {
      setError(support?.reason ?? "Camera support is still being checked.");
      return;
    }
    setPending("camera");
    setError(null);
    try {
      const revealed = await revealLiveHostConnection(room.id);
      setConnection(revealed);
      setObsVisible(false);
      setCameraOpen(true);
    } catch (caught) {
      setError(message(caught, "The camera connection could not be prepared. Sign in again and retry."));
    } finally {
      setPending(null);
    }
  }

  async function revealObs() {
    setPending("obs");
    setError(null);
    try {
      const revealed = connection ?? await revealLiveHostConnection(room.id);
      setConnection(revealed);
      setObsVisible(true);
    } catch (caught) {
      setError(message(caught, "The OBS connection could not be revealed. Sign in again and retry."));
    } finally {
      setPending(null);
    }
  }

  function hideObs() {
    setObsVisible(false);
    setCopied(null);
    if (!cameraOpen) setConnection(null);
  }

  async function refresh() {
    setPending("sync");
    setError(null);
    try {
      const nextRoom = await syncLiveRoom(room.id);
      setRoom(nextRoom);
      if (roomCannotBroadcast(nextRoom.state)) clearHostCredential();
    } catch (caught) {
      setError(message(caught, "The live status could not be refreshed."));
    } finally {
      setPending(null);
    }
  }

  async function end() {
    if (!window.confirm("End this live now? Viewers will lose live playback immediately.")) return;
    setPending("end");
    setError(null);
    clearHostCredential();
    try {
      await endLiveRoom(room.id);
      setRoom({ ...room, playback: { provider: "none", state: "not_ready", url: null }, state: "ended" });
    } catch (caught) {
      setError(message(caught, "The room is closed. Final cleanup may still be retrying."));
    } finally {
      setPending(null);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const finished = roomCannotBroadcast(room.state);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="rounded border border-(--line) bg-(--panel) p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Go live from this device</h2>
            <p className="mt-1 text-sm leading-6 text-(--muted)">Preview your camera and microphone, then start when you are ready.</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-semibold uppercase text-(--accent-strong)">{room.state}</span>
        </div>

        {cameraOpen && connection ? (
          <div className="mt-5">
            <LivepeerBrowserBroadcast onStopped={clearHostCredential} streamKey={connection.streamKey} />
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {support && !support.supported ? (
              <p className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100" role="status">
                {support.reason} You can still use OBS from the advanced setup below.
              </p>
            ) : null}
            <button
              className="min-h-12 justify-self-start rounded bg-(--foreground) px-5 py-3 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={finished || pending !== null || support?.supported !== true}
              onClick={openCamera}
              type="button"
            >
              {pending === "camera" ? "Preparing camera…" : support === null ? "Checking camera support…" : "Set up camera"}
            </button>
            <p className="text-xs leading-5 text-(--muted)">Your browser asks before using the camera or microphone. The host credential stays in this page's memory only.</p>
          </div>
        )}
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded border border-(--line) bg-(--panel) p-4">
          <h2 className="text-sm font-semibold">Room controls</h2>
          <div className="mt-4 grid gap-2">
            <a className="min-h-11 rounded border border-(--line) px-4 py-2.5 text-center text-sm font-semibold" href={`/live/${encodeURIComponent(room.id)}`} target="_blank" rel="noreferrer">Open viewer page</a>
            <button className="min-h-11 rounded border border-(--line) px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={pending !== null || finished} onClick={refresh} type="button">{pending === "sync" ? "Checking…" : "Refresh status"}</button>
            <button className="min-h-11 rounded border border-red-500/50 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50" disabled={pending !== null || finished} onClick={end} type="button">{pending === "end" ? "Ending…" : "End live"}</button>
          </div>
        </section>
        <section className="rounded border border-(--line) bg-(--panel) p-4 text-sm">
          <h2 className="font-semibold">Safety</h2>
          <p className="mt-2 leading-6 text-(--muted)">This room is SFW-only and continuously fail-closed. A suspension removes playback immediately. Any replay stays private until its separate review passes.</p>
        </section>
        {error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</p> : null}
      </aside>

      <details
        className="rounded border border-(--line) bg-(--panel) p-5 lg:col-span-2"
        onToggle={(event) => {
          if (!event.currentTarget.open && obsVisible) hideObs();
        }}
      >
        <summary className="min-h-11 cursor-pointer font-semibold">Advanced: stream with OBS</summary>
        <p className="mt-2 text-sm leading-6 text-(--muted)">Use OBS when you need an external camera, scenes, or overlays. Never share or save the stream key in screenshots.</p>
        {obsVisible && connection ? (
          <div className="mt-5 grid gap-3" aria-live="polite">
            <SecretField label="Server URL" onCopy={() => copy("url", connection.ingestUrl)} value={connection.ingestUrl} copied={copied === "url"} />
            <SecretField label="Stream key" onCopy={() => copy("key", connection.streamKey)} value={connection.streamKey} copied={copied === "key"} secret />
            <button className="justify-self-start text-sm font-semibold text-(--muted) underline" onClick={hideObs} type="button">Hide OBS credentials</button>
          </div>
        ) : (
          <button
            className="mt-4 min-h-11 rounded border border-(--line) px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={finished || pending !== null}
            onClick={revealObs}
            type="button"
          >
            {pending === "obs" ? "Revealing…" : "Reveal OBS connection"}
          </button>
        )}
        <ol className="mt-6 grid gap-2 border-t border-(--line) pt-5 text-sm leading-6 text-(--muted)">
          <li>1. Open OBS Settings → Stream and choose Custom.</li>
          <li>2. Paste the server URL and stream key.</li>
          <li>3. Start streaming in OBS, then refresh status here.</li>
        </ol>
      </details>
    </div>
  );
}

function SecretField({ copied, label, onCopy, secret, value }: { copied: boolean; label: string; onCopy: () => void; secret?: boolean; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-(--muted)">{label}</span>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-(--line) bg-(--background) px-3 py-2.5 text-xs">{secret ? value : value}</code>
        <button className="rounded border border-(--line) px-3 text-sm font-semibold" onClick={onCopy} type="button">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

function message(caught: unknown, fallback: string) {
  return caught instanceof ApiMutationError || caught instanceof Error ? caught.message : fallback;
}

function roomCannotBroadcast(state: LiveRoom["state"]) {
  return state === "suspended" || state === "ended" || state === "replay_ready";
}
