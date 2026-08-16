"use client";

import { useState } from "react";
import type { LiveRoom, RevealedHostConnection } from "@/api-mutations";
import {
  ApiMutationError,
  endLiveRoom,
  revealLiveHostConnection,
  syncLiveRoom
} from "@/api-mutations";

export function LiveHostWorkspace({ initialRoom }: { initialRoom: LiveRoom }) {
  const [room, setRoom] = useState(initialRoom);
  const [connection, setConnection] = useState<RevealedHostConnection | null>(null);
  const [pending, setPending] = useState<"reveal" | "sync" | "end" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setPending("reveal");
    setError(null);
    try {
      setConnection(await revealLiveHostConnection(room.id));
    } catch (caught) {
      setError(message(caught, "The stream key could not be revealed. Sign in again and retry."));
    } finally {
      setPending(null);
    }
  }

  async function refresh() {
    setPending("sync");
    setError(null);
    try {
      setRoom(await syncLiveRoom(room.id));
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
    try {
      await endLiveRoom(room.id);
      setConnection(null);
      setRoom({ ...room, playback: { provider: "none", state: "not_ready", url: null }, state: "ended" });
    } catch (caught) {
      setError(message(caught, "The room was closed locally, but provider cleanup may still be retrying."));
    } finally {
      setPending(null);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const finished = room.state === "ended" || room.state === "replay_ready";

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="rounded border border-(--line) bg-(--panel) p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Connect OBS</h2>
            <p className="mt-1 text-sm leading-6 text-(--muted)">Use the server URL and stream key in OBS. Never share or save the key in screenshots.</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-semibold uppercase text-(--accent-strong)">{room.state}</span>
        </div>

        {connection ? (
          <div className="mt-5 grid gap-3" aria-live="polite">
            <SecretField label="Server URL" onCopy={() => copy("url", connection.ingestUrl)} value={connection.ingestUrl} copied={copied === "url"} />
            <SecretField label="Stream key" onCopy={() => copy("key", connection.streamKey)} value={connection.streamKey} copied={copied === "key"} secret />
            <button className="justify-self-start text-sm font-semibold text-(--muted) underline" onClick={() => setConnection(null)} type="button">Hide credentials</button>
          </div>
        ) : (
          <button
            className="mt-5 min-h-11 rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background) disabled:opacity-50"
            disabled={finished || pending !== null}
            onClick={reveal}
            type="button"
          >
            {pending === "reveal" ? "Revealing…" : "Reveal OBS connection"}
          </button>
        )}

        <ol className="mt-6 grid gap-2 border-t border-(--line) pt-5 text-sm leading-6 text-(--muted)">
          <li>1. Open OBS Settings → Stream and choose Custom.</li>
          <li>2. Paste the server URL and stream key.</li>
          <li>3. Start streaming in OBS, then refresh status here.</li>
        </ol>
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
