"use client";

import { useMemo, useState, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { createSupabaseBrowserClient } from "./client";
import { getRecoveryAuthConfig, type RecoveryAuthProvider } from "./recovery-auth-config";

type RecoveryAuthPanelMode = "login" | "profile";

interface RecoveryAuthPanelProps {
  mode: RecoveryAuthPanelMode;
  next?: string;
}

export function RecoveryAuthPanel({ mode, next = "/app/home" }: RecoveryAuthPanelProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState<"email" | RecoveryAuthProvider["provider"] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useMemo(() => getRecoveryAuthConfig(), []);
  const supabase = useMemo(() => {
    if (!config.supabaseConfigured || (!config.emailEnabled && config.oauthProviders.length === 0)) {
      return null;
    }

    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, [config.emailEnabled, config.oauthProviders.length, config.supabaseConfigured]);
  const isProduction = process.env.NODE_ENV === "production";
  const hasAnyProvider = Boolean(supabase && (config.emailEnabled || config.oauthProviders.length > 0));

  if (!hasAnyProvider) {
    return isProduction ? null : (
      <p className="landing-auth-unavailable">
        Recovery access is unavailable in this local build.
      </p>
    );
  }

  async function startEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (!supabase) {
      setError("Recovery access is unavailable in this local build.");
      return;
    }

    setSubmitting("email");
    setError(null);
    setMessage(null);

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: recoveryRedirectTo(next),
        shouldCreateUser: mode === "profile"
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Recovery email"));
      return;
    }

    setMessage(mode === "profile" ? "Check your email to add recovery access." : "Check your email for the recovery link.");
  }

  async function startOAuthSignIn(provider: RecoveryAuthProvider["provider"]) {
    if (!supabase) {
      setError("Recovery access is unavailable in this local build.");
      return;
    }

    setSubmitting(provider);
    setError(null);
    setMessage(null);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: recoveryRedirectTo(next)
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Recovery login"));
    }
  }

  return (
    <div className="landing-supabase-auth" data-recovery-mode={mode}>
      {config.emailEnabled ? (
        <form className="landing-email-row" noValidate onSubmit={startEmailSignIn}>
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              name={`${mode}-recovery-email`}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <button className="landing-provider-link" disabled={submitting !== null} type="submit">
            <ProviderLogo label="Email" name="email" />
            <span>{submitting === "email" ? "Sending" : "Email recovery"}</span>
          </button>
        </form>
      ) : null}
      {config.oauthProviders.length > 0 ? (
        <div className="landing-provider-row" aria-label="Recovery providers">
          {config.oauthProviders.map((provider) => (
            <button
              className="landing-provider-link"
              disabled={submitting !== null}
              key={provider.provider}
              onClick={() => void startOAuthSignIn(provider.provider)}
              type="button"
            >
              <ProviderLogo label={provider.label} name={provider.logo} />
              <span>{submitting === provider.provider ? "Opening" : provider.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-message" data-error="true">{error}</p> : null}
    </div>
  );
}

function recoveryRedirectTo(next: string) {
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app/home";
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext)}`;
}
