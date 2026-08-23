"use client";

import { useMemo, useState, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { recoveryIdentityMayBeCreated } from "@/wallet/auth-purpose-policy";
import { createSupabaseBrowserClient } from "./client";
import { getSupabaseAuthConfig, type SupabaseAuthProvider } from "./supabase-auth-config";

interface SupabaseAuthPanelProps {
  next?: string;
  mode?: "link" | "recovery";
}

export function SupabaseAuthPanel({ mode = "link", next = "/app/home" }: SupabaseAuthPanelProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState<"email" | SupabaseAuthProvider["provider"] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useMemo(() => getSupabaseAuthConfig(), []);
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
  const isLocalPreview = config.appUrl.includes("localhost") || config.appUrl.includes("127.0.0.1");
  const hasAnyProvider = Boolean(supabase && (config.emailEnabled || config.oauthProviders.length > 0));

  if (!hasAnyProvider) {
    return isProduction && !isLocalPreview ? null : (
      <div className="landing-supabase-auth">
        <p className="landing-auth-unavailable">
          {config.supabaseConfigured
            ? "Recovery sign-in options are not enabled."
            : "Recovery access is unavailable in this build."}
        </p>
      </div>
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
      setError("Recovery access is unavailable in this build.");
      return;
    }

    setSubmitting("email");
    setError(null);
    setMessage(null);

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: supabaseRedirectTo(next),
        shouldCreateUser: recoveryIdentityMayBeCreated(mode)
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Recovery access"));
      return;
    }

    setMessage(mode === "link" ? "Check your email to add recovery access." : "Check your email to continue account recovery.");
  }

  async function startOAuthSignIn(provider: SupabaseAuthProvider["provider"]) {
    if (!supabase) {
      setError("Recovery access is unavailable in this build.");
      return;
    }

    setSubmitting(provider);
    setError(null);
    setMessage(null);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: supabaseRedirectTo(next)
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Recovery access"));
    }
  }

  return (
    <div className="landing-supabase-auth" data-recovery-auth="true">
      {config.emailEnabled ? (
        <form className="landing-email-row" noValidate onSubmit={startEmailSignIn}>
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="recovery-email"
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
            <span>{submitting === "email" ? "Sending" : mode === "link" ? "Add recovery email" : "Send recovery link"}</span>
          </button>
        </form>
      ) : null}
      {config.oauthProviders.length > 0 ? (
        <div className="landing-provider-row" aria-label="Recovery sign-in options">
          {config.oauthProviders.map((provider) => (
            <button
              className="landing-provider-link"
              disabled={submitting !== null}
              key={provider.provider}
              onClick={() => void startOAuthSignIn(provider.provider)}
              type="button"
            >
              <ProviderLogo label={provider.label} name={provider.logo} />
              <span>{submitting === provider.provider ? "Opening" : mode === "link" ? `Add ${provider.label} recovery` : `Continue with ${provider.label}`}</span>
            </button>
          ))}
        </div>
      ) : null}
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-message" data-error="true">{error}</p> : null}
    </div>
  );
}

function supabaseRedirectTo(next: string) {
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app/home";
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext)}`;
}
