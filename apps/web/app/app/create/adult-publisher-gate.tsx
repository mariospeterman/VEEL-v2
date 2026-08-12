"use client";

import { useState } from "react";
import { ApiMutationError, createVerificationSession } from "@/api-mutations";
import type { VerificationStatus } from "@/api-client";

export function AdultPublisherGate({ verification }: { verification: VerificationStatus | null }) {
  const [starting, setStarting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibility = verification?.verificationSummary.adultPublisherEligibility ?? null;
  const pending = eligibility?.status === "pending";

  async function startVerification() {
    if (!termsAccepted) return;
    setStarting(true);
    setError(null);
    try {
      const session = await createVerificationSession({
        purpose: "adult_publisher_eligibility",
        providerPreference: "provider_first",
        source: "create",
        adultPublisherTermsAccepted: true
      });
      window.location.assign(session.launchUrl);
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "Identity verification could not start.");
      setStarting(false);
    }
  }

  return (
    <section className="grid gap-3 border-y border-(--line) py-4">
      <div>
        <p className="text-sm font-semibold">Adult publisher verification</p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-(--muted)">
          Because this depicts adults, verify your identity and confirm every person shown is 18+ and agreed to this use.
          We store only the result.
        </p>
      </div>
      {pending ? (
        <p className="text-sm text-(--muted)">Your verification is being reviewed.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm text-(--muted)">
            <input
              checked={termsAccepted}
              className="mt-1 size-4 accent-(--accent)"
              onChange={(event) => setTermsAccepted(event.target.checked)}
              type="checkbox"
            />
            <span>I am 18+ and agree to the Adult Publisher Terms.</span>
          </label>
          <button
            className="min-h-11 w-fit rounded border border-(--line) px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!termsAccepted || starting}
            onClick={() => void startVerification()}
            type="button"
          >
            {starting ? "Opening identity check" : "Verify identity"}
          </button>
        </>
      )}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
