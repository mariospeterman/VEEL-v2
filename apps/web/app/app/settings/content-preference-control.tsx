"use client";

import { useState } from "react";
import type { FeedPreferences } from "@/api-client";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { updateFeedPreferences } from "@/api-mutations";

type ContentPreference = FeedPreferences["nsfwPreference"];

const options: Array<{ value: ContentPreference; label: string; description: string }> = [
  { value: "both", label: "Both", description: "Show Safe and Adult posts." },
  { value: "sfw", label: "Safe only", description: "Hide Adult and Explicit posts." },
  { value: "nsfw", label: "Adult only", description: "Show Adult and Explicit posts." }
];

export function ContentPreferenceControl({
  initialPreference,
  compact = false,
  onChanged
}: {
  initialPreference: ContentPreference;
  compact?: boolean;
  onChanged?: (preference: ContentPreference) => void;
}) {
  const [preference, setPreference] = useState(initialPreference);
  const [pending, setPending] = useState<ContentPreference | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function select(next: ContentPreference) {
    if (next === preference || pending) return;
    setPending(next);
    setError(null);
    try {
      const updated = await updateFeedPreferences(
        { nsfwPreference: next },
        createMutationIdempotencyKey()
      );
      setPreference(updated.nsfwPreference);
      onChanged?.(updated.nsfwPreference);
    } catch (failure) {
      setError(safeMutationMessage(failure, "Content preference"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div
        aria-label="Content preference"
        className={compact ? "grid grid-cols-3 gap-2" : "grid gap-2 sm:grid-cols-3"}
        role="group"
      >
        {options.map((option) => (
          <button
            aria-pressed={preference === option.value}
            className={
              preference === option.value
                ? "min-h-11 rounded-full border border-(--accent) bg-(--accent) px-3 py-2 text-sm font-semibold text-white"
                : "min-h-11 rounded-full border border-(--line) bg-(--surface) px-3 py-2 text-sm font-semibold text-(--foreground) hover:border-(--accent)"
            }
            disabled={pending !== null}
            key={option.value}
            onClick={() => void select(option.value)}
            title={option.description}
            type="button"
          >
            {pending === option.value ? "Saving…" : option.label}
          </button>
        ))}
      </div>
      {!compact ? (
        <p className="text-sm text-(--muted)">
          {options.find((option) => option.value === preference)?.description}
        </p>
      ) : null}
      {error ? <p className="text-sm text-(--danger)" role="alert">{error}</p> : null}
    </div>
  );
}
