"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { WebAuthState } from "@/supabase/auth-state";
import { createSupabaseBrowserClient } from "@/supabase/client";

interface EnterAuthPanelProps {
  initialAuthState: WebAuthState;
  authError?: string | null;
  nextPath: string;
}

export function EnterAuthPanel({ initialAuthState, authError, nextPath }: EnterAuthPanelProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "signed_out" | "error">("idle");
  const [message, setMessage] = useState<string | null>(authError ? "Sign-in link could not be confirmed." : null);
  const [submitting, setSubmitting] = useState(false);
  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  async function startEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    if (!supabase) {
      setStatus("error");
      setMessage("Supabase sign-in is not configured.");
      setSubmitting(false);
      return;
    }

    const redirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    setSubmitting(false);

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
    setMessage("Check your email for the Veel sign-in link.");
  }

  async function signOut() {
    setSubmitting(true);
    setMessage(null);
    const { error } = supabase ? await supabase.auth.signOut() : { error: new Error("Supabase sign-in is not configured.") };
    setSubmitting(false);

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("signed_out");
    setMessage("Signed out on this device.");
    window.location.reload();
  }

  return (
    <div className="grid gap-4 rounded border border-(--line) bg-(--background) p-4">
      <div>
        <p className="text-xs font-semibold uppercase text-(--accent)">Email magic link</p>
        <h2 className="mt-2 text-base font-semibold tracking-normal">
          {initialAuthState.authenticated ? "Session active" : "Sign in or sign up"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          {initialAuthState.authenticated
            ? initialAuthState.email ?? "Authenticated session"
            : "Use email to continue. Wallet and age checks remain backend verified."}
        </p>
      </div>

      {!initialAuthState.authenticated ? (
        <form className="grid gap-3" onSubmit={startEmailSignIn}>
          <label className="grid gap-2 text-sm font-medium">
            Email
            <input
              className="rounded border border-(--line) bg-(--panel) px-3 py-3 text-(--foreground) outline-none focus:border-(--accent)"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <button
            className="rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting || !initialAuthState.configured}
            type="submit"
          >
            {submitting ? "Sending" : "Send sign-in link"}
          </button>
        </form>
      ) : (
        <button
          className="rounded border border-(--line) px-4 py-3 text-sm font-semibold text-(--foreground) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          onClick={signOut}
          type="button"
        >
          {submitting ? "Signing out" : "Sign out"}
        </button>
      )}

      {message ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            status === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--panel) text-(--muted)"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
