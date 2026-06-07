"use client";

import { useState } from "react";
import { ApiMutationError, createAgeSession, type AgeSession } from "@/api-mutations";
import type { WebAuthState } from "@/supabase/auth-state";

interface AgeSessionPanelProps {
  authState: WebAuthState;
}

export function AgeSessionPanel({ authState }: AgeSessionPanelProps) {
  const [state, setState] = useState<"idle" | "starting" | "ready" | "error">("idle");
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
      setSession(providerSession);
      setState("ready");
      setMessage("Provider session created. Continue with the provider; Veel waits for the signed webhook.");
      window.location.assign(providerSession.launchUrl);
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="text-sm font-medium">Provider sessions</p>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        Session launch URLs are created by the backend only after an explicit user action. The page does not render
        fixture provider links or treat redirects as verification.
      </p>

      <button
        className="mt-4 w-full rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state === "starting" || !authState.authenticated}
        onClick={startAgeSession}
        type="button"
      >
        {state === "starting" ? "Starting provider" : "Start age verification"}
      </button>

      {session ? (
        <a
          className="mt-3 block truncate rounded border border-(--line) px-3 py-2 text-sm text-(--foreground)"
          href={session.launchUrl}
        >
          Continue with {session.provider}
        </a>
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
  if (error instanceof ApiMutationError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Age verification could not be started.";
}
