"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";
import { clearWalletSession } from "@/wallet/wallet-session";

export function ProfileLogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);

    try {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      } catch (reason) {
        if (isMissingSupabaseConfig(reason)) {
          // Wallet-only local development can run without Supabase browser auth.
        } else {
          throw reason;
        }
      }

      clearWalletSession();
      clearCookie(e2eAuthCookieName);
      window.location.assign("/");
    } catch {
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

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function isMissingSupabaseConfig(reason: unknown) {
  return reason instanceof Error && reason.message === "Supabase browser client is not configured";
}
