"use client";

import { useMemo, useState, type FormEvent } from "react";
import { parsePublicWebEnv } from "@veel/config";
import type { WebAuthState } from "@/supabase/auth-state";
import { createSupabaseBrowserClient } from "@/supabase/client";

interface ProfileCompletionPanelProps {
  authState: WebAuthState;
}

export function ProfileCompletionPanel({ authState }: ProfileCompletionPanelProps) {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    if (!supabase) {
      setState("error");
      setMessage("Supabase sign-in is not configured.");
      setSubmitting(false);
      return;
    }

    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setState("error");
      setMessage("Create or restore a session before completing profile.");
      setSubmitting(false);
      return;
    }

    const env = parsePublicWebEnv(process.env);
    const response = await fetch(new URL("/v1/profiles/me", env.NEXT_PUBLIC_API_BASE_URL), {
      body: JSON.stringify({
        handle,
        displayName,
        ...(bio ? { bio } : {}),
        ...(locationLabel ? { locationLabel } : {})
      }),
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID()
      },
      method: "PATCH"
    });

    setSubmitting(false);

    if (!response.ok) {
      setState("error");
      setMessage(await errorMessage(response));
      return;
    }

    setState("saved");
    setMessage("Profile saved. Continue with wallet and age readiness.");
  }

  return (
    <form className="grid gap-3 rounded border border-(--line) bg-(--background) p-4" onSubmit={submitProfile}>
      <div>
        <p className="text-xs font-semibold uppercase text-(--accent)">Profile</p>
        <h2 className="mt-2 text-base font-semibold tracking-normal">Complete identity</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          This creates the backend profile required before wallet and age readiness can open the protected app shell.
        </p>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Handle
        <input
          className="rounded border border-(--line) bg-(--panel) px-3 py-3 text-(--foreground) outline-none focus:border-(--accent)"
          maxLength={32}
          minLength={2}
          onChange={(event) => setHandle(event.target.value)}
          pattern="[a-zA-Z0-9_]{2,32}"
          placeholder="veel_creator"
          required
          value={handle}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Display name
        <input
          className="rounded border border-(--line) bg-(--panel) px-3 py-3 text-(--foreground) outline-none focus:border-(--accent)"
          maxLength={80}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Veel Creator"
          required
          value={displayName}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Bio
        <textarea
          className="min-h-24 rounded border border-(--line) bg-(--panel) px-3 py-3 text-(--foreground) outline-none focus:border-(--accent)"
          maxLength={500}
          onChange={(event) => setBio(event.target.value)}
          placeholder="Short creator profile"
          value={bio}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Location
        <input
          className="rounded border border-(--line) bg-(--panel) px-3 py-3 text-(--foreground) outline-none focus:border-(--accent)"
          maxLength={120}
          onChange={(event) => setLocationLabel(event.target.value)}
          placeholder="Optional"
          value={locationLabel}
        />
      </label>

      <button
        className="rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting || !authState.authenticated}
        type="submit"
      >
        {submitting ? "Saving" : "Save profile"}
      </button>

      {message ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            state === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--panel) text-(--muted)"
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.code === "string" && body.code) return body.code;
  } catch {
    return response.statusText || "Profile update failed";
  }

  return response.statusText || "Profile update failed";
}
