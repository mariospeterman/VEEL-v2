"use client";

import { useState } from "react";
import type { NotificationPreferences } from "@/api-client";
import { updateNotificationPreferences } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

const preferenceOptions = [
  ["messagesEnabled", "Messages"],
  ["engagementEnabled", "Engagement"],
  ["liveEnabled", "Live"],
  ["paymentsEnabled", "Payments"],
  ["membershipsEnabled", "Memberships"],
  ["eventAccessEnabled", "Event access"],
  ["mutualsEnabled", "Mutuals"],
  ["safetyEnabled", "Safety"],
  ["walletEnabled", "Wallet"],
  ["creatorSetupEnabled", "Creator setup"],
  ["studioSetupEnabled", "Studio setup"],
  ["pushEnabled", "Browser push"]
] as const;

type PreferenceKey = (typeof preferenceOptions)[number][0];

export function NotificationPreferencesPanel({ initial }: { initial: NotificationPreferences }) {
  const [preferences, setPreferences] = useState(initial);
  const [pending, setPending] = useState<PreferenceKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(key: PreferenceKey) {
    const next = !preferences[key];
    setPending(key);
    setMessage(null);
    try {
      const updated = await updateNotificationPreferences({ [key]: next });
      setPreferences(updated);
      setMessage("Notification preferences saved.");
    } catch (error) {
      setMessage(safeMutationMessage(error, "Notification preferences"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {preferenceOptions.map(([key, label]) => (
        <button
          aria-checked={preferences[key]}
          className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-left text-sm disabled:opacity-60"
          disabled={pending !== null}
          key={key}
          onClick={() => void toggle(key)}
          role="switch"
          type="button"
        >
          <span>{label}</span>
          <span className={preferences[key] ? "text-(--accent-text)" : "text-(--muted)"}>
            {pending === key ? "Saving" : preferences[key] ? "On" : "Off"}
          </span>
        </button>
      ))}
      {message ? <p aria-live="polite" className="text-sm text-(--muted) sm:col-span-2">{message}</p> : null}
    </div>
  );
}
