"use client";

import { useState } from "react";
import { createAgeSession, resumeAgeSession, type AgeSession } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import type { WebAuthState } from "@/supabase/auth-state";

interface AgeSessionPanelProps {
  authState: WebAuthState;
}

export function AgeSessionPanel({ authState }: AgeSessionPanelProps) {
  const [state, setState] = useState<"idle" | "starting" | "resuming" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<AgeSession | null>(null);

  async function startAgeSession() {
    setState("starting");
    setMessage(null);
    setSession(null);

    try {
      const providerSession = await createAgeSession({
        providerPreference: "reusable_first"
      });
      await presentOrResumeSession(providerSession, true);
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  async function presentOrResumeSession(providerSession: AgeSession, attemptResume: boolean) {
    let current = providerSession;
    setSession(current);

    if (!current.launchUrl && current.resumable && attemptResume) {
      setState("resuming");
      setMessage(current.providerReference
        ? "Checking the existing secure age-verification handoff..."
        : "Checking whether the provider handoff can be recovered...");
      current = await resumeAgeSession(current.id);
      setSession(current);
    }

    setState("ready");
    if (current.launchUrl) {
      setMessage("Your secure age check is ready. Continue to complete it.");
      window.location.assign(current.launchUrl);
      return;
    }

    setMessage(current.launchState === "failed" || current.status === "needs_review"
      ? "We could not recover the provider handoff identifier. Contact support; WeVid will not start a second session until this attempt is reconciled."
      : current.resumable && !current.providerReference
        ? "The provider request may still be completing. Check this handoff again later; WeVid will not open a second session while it may still be active."
        : current.resumable
        ? "The secure provider handoff is still being reconciled. Use Resume to check this same session again."
        : "The provider outcome is still uncertain. We will not open a second session while this attempt is being reconciled.");
  }

  async function resumeCurrentSession() {
    if (!session) return;
    setState("resuming");
    setMessage(null);
    try {
      await presentOrResumeSession(session, true);
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="text-sm font-medium">Age verification</p>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        Start a secure age check when you’re ready. WeVid unlocks age-restricted areas only after the check is confirmed.
      </p>

      <button
        className="mt-4 w-full rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state === "starting" || state === "resuming" || !authState.authenticated}
        onClick={startAgeSession}
        type="button"
      >
        {state === "starting" ? "Starting verification" : state === "resuming" ? "Checking verification" : "Start age verification"}
      </button>

      {session?.launchUrl ? (
        <a
          className="mt-3 block truncate rounded border border-(--line) px-3 py-2 text-sm text-(--foreground)"
          href={session.launchUrl}
        >
          Continue age verification
        </a>
      ) : null}

      {session && !session.launchUrl && session.resumable ? (
        <button
          className="mt-3 w-full rounded border border-(--line) px-3 py-2 text-sm font-semibold text-(--foreground) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === "starting" || state === "resuming"}
          onClick={() => void resumeCurrentSession()}
          type="button"
        >
          {state === "resuming"
            ? "Checking secure handoff"
            : session.providerReference
              ? "Resume age verification"
              : "Check handoff status"}
        </button>
      ) : null}

      {message ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            state === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--background) text-(--muted)"
          }`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown) {
  return safeMutationMessage(error, "Age verification");
}
