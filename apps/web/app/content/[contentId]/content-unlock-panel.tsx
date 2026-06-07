"use client";

import { useState } from "react";
import {
  ApiMutationError,
  createContentUnlockIntent,
  getPaymentTransactionRequest,
  type ContentUnlockIntent,
  type TransactionRequest
} from "@/api-mutations";

interface ContentUnlockPanelProps {
  contentId: string;
  accessState: string;
}

export function ContentUnlockPanel({ contentId, accessState }: ContentUnlockPanelProps) {
  const needsUnlock = accessState === "locked" || accessState === "teaser";
  const [state, setState] = useState<"idle" | "creating" | "ready" | "granted" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [unlock, setUnlock] = useState<ContentUnlockIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);

  async function startUnlock() {
    setState("creating");
    setMessage(null);
    setUnlock(null);
    setTransaction(null);

    try {
      const unlockIntent = await createContentUnlockIntent(contentId);
      setUnlock(unlockIntent);

      if (unlockIntent.state === "already_unlocked") {
        setState("granted");
        setMessage("Access is already reflected by the backend entitlement projection.");
        return;
      }

      if (!unlockIntent.paymentIntent) {
        throw new ApiMutationError("Unlock requires payment but no payment intent was returned.");
      }

      const transactionRequest = await getPaymentTransactionRequest(unlockIntent.paymentIntent.id);
      setTransaction(transactionRequest);
      setState("ready");
      setMessage("Open the wallet request. Access changes only after backend settlement verification.");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4" id="unlock">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Access</p>
          <p className="mt-1 text-sm text-(--muted)">Backend entitlement required</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium uppercase text-(--accent-strong)">
          {accessState}
        </span>
      </div>

      <div className="mt-5 grid gap-3 border-t border-(--line) pt-4">
        <p className="text-sm leading-6 text-(--muted)">
          {needsUnlock
            ? "Unlock pricing and wallet handoff are created by the API; wallet approval is never treated as final access."
            : "Full access is already reflected by the backend projection."}
        </p>

        {needsUnlock ? (
          <button
            className="rounded bg-(--foreground) px-3 py-2 text-center text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
            disabled={state === "creating"}
            onClick={startUnlock}
            type="button"
          >
            {state === "creating" ? "Creating intent" : "Start unlock"}
          </button>
        ) : null}

        {unlock?.paymentIntent ? (
          <div className="grid gap-2 rounded border border-(--line) bg-(--background) p-3 text-sm">
            <Fact label="Amount" value={`${unlock.paymentIntent.amountMinor.toLocaleString()} ${unlock.paymentIntent.currency}`} />
            <Fact label="Intent" value={unlock.paymentIntent.state} />
          </div>
        ) : null}

        {transaction ? (
          <a
            className="rounded border border-(--line) px-3 py-2 text-center text-sm font-semibold text-(--foreground)"
            href={transaction.transactionRequestUrl}
          >
            Open wallet request
          </a>
        ) : null}

        {message ? (
          <p
            className={`rounded border px-3 py-2 text-sm ${
              state === "error"
                ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
                : "border-(--line) bg-(--background) text-(--muted)"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiMutationError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unlock could not be started.";
}
