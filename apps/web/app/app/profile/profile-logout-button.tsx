"use client";

import { useState } from "react";
import { revokeWalletAuthSession } from "@/api-mutations";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";
import { useProviderSessionLogout } from "@/wallet/provider-session-logout";
import { clearWalletSession } from "@/wallet/wallet-session";

export function ProfileLogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoutProviderSessions = useProviderSessionLogout();

  async function logout() {
    setPending(true);
    setError(null);
    clearBrowserSessionState();

    const redirectFallback = window.setTimeout(() => {
      window.location.replace("/");
    }, 2_500);

    try {
      await Promise.allSettled([
        withTimeout(revokeWalletAuthSession(), 1_200),
        withTimeout(logoutProviderSessions(), 1_800),
        withTimeout(logoutSupabase(), 1_200),
        withTimeout(clearServerSession(), 1_200)
      ]);
      window.clearTimeout(redirectFallback);
      window.location.replace("/");
    } catch {
      window.clearTimeout(redirectFallback);
      setError("Logout could not finish. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button className="secondary-button w-full" disabled={pending} onClick={() => void logout()} type="button">
        {pending ? "Logging out" : "Log out"}
      </button>
      {error ? <p className="text-xs leading-5 text-(--danger)">{error}</p> : null}
    </div>
  );
}

async function logoutSupabase() {
  try {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  } catch (reason) {
    if (!isMissingSupabaseConfig(reason)) {
      throw reason;
    }
  }
}

async function clearServerSession() {
  await fetch("/auth/logout", {
    cache: "no-store",
    credentials: "include",
    method: "POST"
  });
}

function clearBrowserSessionState() {
  runBestEffort(clearWalletSession);
  runBestEffort(() => clearCookie(e2eAuthCookieName));
}

function clearCookie(name: string) {
  const parts = [`${name}=`, "path=/", "max-age=0", "samesite=lax"];

  if (window.location.protocol === "https:") {
    parts.push("secure");
  }

  document.cookie = parts.join("; ");
}

function isMissingSupabaseConfig(reason: unknown) {
  return reason instanceof Error && reason.message === "Supabase browser client is not configured";
}

function runBestEffort(cleanup: () => void) {
  try {
    cleanup();
  } catch {
    // Logout redirect must not depend on local browser storage availability.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Logout step timed out")), timeoutMs);
    })
  ]);
}
