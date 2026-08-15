"use client";

import { useState } from "react";
import { createRecoveryLinkIntent, unlinkRecoveryIdentity } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { SupabaseAuthPanel } from "@/supabase/supabase-auth-panel";

export function RecoveryAccessPanel() {
  const [linkReady, setLinkReady] = useState(false);
  const [pending, setPending] = useState<"link" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function beginLink() {
    setPending("link");
    setError(null);
    try {
      await createRecoveryLinkIntent();
      setLinkReady(true);
    } catch (reason) {
      setError(safeMutationMessage(reason, "Recovery access"));
    } finally {
      setPending(null);
    }
  }

  async function unlink() {
    setPending("unlink");
    setError(null);
    try {
      await unlinkRecoveryIdentity();
      setLinkReady(false);
    } catch (reason) {
      setError(safeMutationMessage(reason, "Recovery access"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3 sm:col-span-2">
      <p className="text-sm text-(--muted)">Recovery email is optional and is never used to merge accounts by matching email.</p>
      {!linkReady ? (
        <button className="secondary-button" disabled={pending !== null} onClick={() => void beginLink()} type="button">
          {pending === "link" ? "Preparing recovery" : "Add recovery access"}
        </button>
      ) : (
        <SupabaseAuthPanel mode="profile" next="/app/settings#security" />
      )}
      <button className="secondary-button" disabled={pending !== null} onClick={() => void unlink()} type="button">
        {pending === "unlink" ? "Removing recovery" : "Remove recovery access"}
      </button>
      {error ? <p className="text-sm text-(--danger)">{error}</p> : null}
    </div>
  );
}
