"use client";

import { useState } from "react";
import { ApiMutationError, createLiveRoom } from "@/api-mutations";

type AccessMode = "public" | "profile_members" | "paid_event";

export function LiveCreateWorkspace({ enabled }: { enabled: boolean }) {
  const [title, setTitle] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("public");
  const [membersOnlyChat, setMembersOnlyChat] = useState(false);
  const [membersIncluded, setMembersIncluded] = useState(false);
  const [eventPrice, setEventPrice] = useState("0.05");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const eventPriceMinor = Math.round(Number(eventPrice) * 1_000_000_000);
      if (accessMode === "paid_event" && (!Number.isSafeInteger(eventPriceMinor) || eventPriceMinor < 1)) {
        throw new Error("Enter a valid SOL event price.");
      }

      const room = await createLiveRoom({
        accessMode,
        ...(accessMode === "paid_event" ? { eventPriceMinor } : {}),
        membersIncludedInPaidEvent: accessMode === "paid_event" && membersIncluded,
        membersOnlyChat,
        previewSeconds: accessMode === "paid_event" ? 60 : 0,
        replayWindowHours: 48,
        sfwAttestation: "this_live_stream_is_sfw",
        title: title.trim()
      });
      window.location.assign(`/app/live/${encodeURIComponent(room.id)}`);
    } catch (caught) {
      setError(
        caught instanceof ApiMutationError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Live setup could not be created."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4 sm:p-5">
      <div>
        <p className="text-sm font-medium text-(--accent-text)">Live</p>
        <h2 className="mt-1 text-lg font-semibold tracking-normal">Start with OBS</h2>
        <p className="mt-1 text-sm leading-6 text-(--muted)">
          Create the room, then connect OBS from a private host screen. Adult live is not available.
        </p>
      </div>

      <form className="mt-5 grid gap-4 border-t border-(--line) pt-5" onSubmit={onSubmit}>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Title</span>
          <input
            className="min-h-12 rounded border border-(--line) bg-(--background) px-3"
            maxLength={120}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="What are you going live about?"
            required
            value={title}
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Who can watch?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <AccessChoice checked={accessMode === "public"} label="Everyone" onChange={() => setAccessMode("public")} />
            <AccessChoice checked={accessMode === "profile_members"} label="Members" onChange={() => setAccessMode("profile_members")} />
            <AccessChoice checked={accessMode === "paid_event"} label="Paid event" onChange={() => setAccessMode("paid_event")} />
          </div>
        </fieldset>

        {accessMode === "paid_event" ? (
          <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Event price (SOL)</span>
              <input
                className="min-h-11 rounded border border-(--line) bg-(--panel) px-3"
                inputMode="decimal"
                min="0.000000001"
                onChange={(event) => setEventPrice(event.currentTarget.value)}
                required
                step="0.000000001"
                type="number"
                value={eventPrice}
              />
            </label>
            <label className="flex items-center gap-3 self-end py-3 text-sm">
              <input checked={membersIncluded} onChange={(event) => setMembersIncluded(event.currentTarget.checked)} type="checkbox" />
              <span>Include active members</span>
            </label>
          </div>
        ) : null}

        <label className="flex items-center gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
          <input checked={membersOnlyChat} onChange={(event) => setMembersOnlyChat(event.currentTarget.checked)} type="checkbox" />
          <span>Only active members can chat</span>
        </label>

        <label className="flex items-start gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm leading-5">
          <input className="mt-0.5" checked={attested} onChange={(event) => setAttested(event.currentTarget.checked)} type="checkbox" />
          <span>I confirm this live will remain safe-for-work and follows the live safety policy.</span>
        </label>

        <button
          className="min-h-12 rounded bg-(--foreground) px-4 py-3 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!enabled || !attested || title.trim().length === 0 || pending}
          type="submit"
        >
          {pending ? "Creating room…" : "Create live room"}
        </button>
        {!enabled ? <p className="text-sm text-(--muted)">Finish age access before creating a live room.</p> : null}
        {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

function AccessChoice({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className={`flex min-h-12 items-center gap-3 rounded border p-3 text-sm ${checked ? "border-(--accent) bg-(--accent-soft)" : "border-(--line) bg-(--background)"}`}>
      <input checked={checked} name="access-mode" onChange={onChange} type="radio" />
      <span className="font-medium">{label}</span>
    </label>
  );
}
