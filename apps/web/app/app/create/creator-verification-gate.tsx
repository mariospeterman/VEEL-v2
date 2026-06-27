"use client";

import { useState } from "react";
import { createVerificationSession, ApiMutationError } from "@/api-mutations";
import type { VerificationStatus } from "@/api-client";
import { Card, StatusPill } from "../../ui";

export function CreatorVerificationGate({ verification }: { verification: VerificationStatus | null }) {
  const [state, setState] = useState<"idle" | "starting" | "launched">("idle");
  const [error, setError] = useState<string | null>(null);
  const creatorKyc = verification?.verificationSummary.creatorKyc ?? null;
  const pending = creatorKyc?.status === "pending";

  async function startCreatorKyc() {
    setState("starting");
    setError(null);

    try {
      const session = await createVerificationSession({
        purpose: "creator_kyc",
        providerPreference: "provider_first"
      });
      setState("launched");
      window.location.assign(session.launchUrl);
    } catch (caught) {
      setState("idle");
      setError(caught instanceof ApiMutationError ? caught.message : "Creator verification could not start.");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-(--accent)">Creator verification</p>
          <h2 className="mt-2 text-xl font-semibold tracking-normal">Unlock uploads and publishing</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
            WeVid only needs creator KYC before upload, publish, monetization, and payout features.
            Your age check stays reused unless risk, jurisdiction, or provider expiry requires a refresh.
          </p>
        </div>
        {creatorKyc ? <StatusPill>{creatorKyc.status}</StatusPill> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center rounded border border-(--line) px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state === "starting" || pending}
          onClick={startCreatorKyc}
          type="button"
        >
          {pending ? "Verification pending" : state === "starting" ? "Starting..." : "Verify creator identity"}
        </button>
        {pending ? (
          <span className="text-sm text-(--muted)">Provider review is in progress. This page unlocks after webhook approval.</span>
        ) : null}
        {state === "launched" ? (
          <span className="text-sm text-(--muted)">Opening the provider session...</span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </Card>
  );
}
