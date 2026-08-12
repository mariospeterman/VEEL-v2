"use client";

import { useState } from "react";
import type { PerformerConsentRequest } from "@/api-client";
import { publicMutation } from "@/api-mutation-transport";

interface VerificationSession {
  launchUrl: string;
}

export function PerformerConsentActions({ invitation, token }: {
  invitation: PerformerConsentRequest;
  token: string;
}) {
  const [pending, setPending] = useState<"verify" | "accept" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canAccept = invitation.verificationState === "valid";

  async function startVerification() {
    setPending("verify");
    setMessage(null);
    try {
      sessionStorage.setItem("veel_performer_invitation", token);
      const session = await publicMutation<VerificationSession>(
        `/v1/performer-invitations/${encodeURIComponent(token)}/verification-sessions`,
        "POST",
        {}
      );
      window.location.assign(session.launchUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verification could not be started");
      setPending(null);
    }
  }

  async function respond(decision: "accept" | "reject") {
    setPending(decision);
    setMessage(null);
    try {
      await publicMutation(
        `/v1/performer-invitations/${encodeURIComponent(token)}/responses`,
        "POST",
        { decision }
      );
      sessionStorage.removeItem("veel_performer_invitation");
      setMessage(decision === "accept" ? "Consent recorded." : "Request declined.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your response could not be saved");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3">
      {!canAccept ? (
        <button
          className="min-h-12 rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:opacity-60"
          disabled={pending !== null}
          onClick={startVerification}
          type="button"
        >
          {pending === "verify" ? "Opening verification" : "Verify age and identity"}
        </button>
      ) : (
        <button
          className="min-h-12 rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:opacity-60"
          disabled={pending !== null}
          onClick={() => respond("accept")}
          type="button"
        >
          {pending === "accept" ? "Recording consent" : "Accept exact scope"}
        </button>
      )}
      <button
        className="min-h-12 rounded border border-(--line) px-4 py-3 text-sm font-semibold disabled:opacity-60"
        disabled={pending !== null}
        onClick={() => respond("reject")}
        type="button"
      >
        {pending === "reject" ? "Declining" : "Decline"}
      </button>
      {message ? <p className="text-sm text-(--muted)" role="status">{message}</p> : null}
    </div>
  );
}
