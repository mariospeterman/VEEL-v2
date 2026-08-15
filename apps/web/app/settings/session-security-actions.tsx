"use client";

import { useState } from "react";
import { ApiMutationError, revokeAllApplicationSessions } from "@/api-mutations";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { useProviderSessionLogout } from "@/wallet/provider-session-logout";

export function SessionSecurityActions() {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoutProviderSessions = useProviderSessionLogout();

  async function logoutAll() {
    setPending(true);
    setError(null);

    try {
      await revokeAllApplicationSessions();
      await Promise.allSettled([
        logoutProviderSessions(),
        logoutSupabaseLocally(),
        fetch("/auth/logout", { cache: "no-store", credentials: "include", method: "POST" })
      ]);
      window.location.replace("/");
    } catch (reason) {
      setPending(false);
      setError(
        reason instanceof ApiMutationError && reason.status === 403
          ? "For security, log out and sign in again before ending every device session."
          : "WeVid could not end every device session. Try again in a moment."
      );
    }
  }

  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className="rounded border border-(--line) p-3">
        <p className="text-sm font-medium">Device sessions</p>
        <p className="mt-1 text-xs leading-5 text-(--muted)">
          End every WeVid session if you lost a device or think your account is at risk.
        </p>
        {confirming ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="secondary-button" disabled={pending} onClick={() => void logoutAll()} type="button">
              {pending ? "Ending sessions" : "Confirm log out all devices"}
            </button>
            <button className="ghost-button" disabled={pending} onClick={() => setConfirming(false)} type="button">
              Cancel
            </button>
          </div>
        ) : (
          <button className="secondary-button mt-3" onClick={() => setConfirming(true)} type="button">
            Log out all devices
          </button>
        )}
        {error ? <p className="mt-2 text-xs leading-5 text-(--danger)">{error}</p> : null}
      </div>
    </div>
  );
}

async function logoutSupabaseLocally() {
  try {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Supabase recovery is optional and does not control the WeVid session revocation.
  }
}
