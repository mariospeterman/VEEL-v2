"use client";

import { useState } from "react";
import type { Event } from "@/api-client";
import {
  ApiMutationError,
  createEventAccessPassIntent,
  getPaymentTransactionRequest,
  type PaymentIntent,
  type TransactionRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

interface EventAccessPassPanelProps {
  event: Event;
}

export function EventAccessPassPanel({ event }: EventAccessPassPanelProps) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <h2 className="text-base font-semibold tracking-normal">Access pass sheet</h2>
      <div className="mt-4 grid gap-3">
        {event.accessPassTypes.map((accessPassType) => (
          <EventAccessPassOption event={event} key={accessPassType.id} accessPassType={accessPassType} />
        ))}
        {event.accessPassTypes.length === 0 ? (
          <p className="rounded border border-(--line) bg-(--background) p-4 text-sm text-(--muted)">
            No active pass types are available.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function EventAccessPassOption({
  event,
  accessPassType
}: {
  event: Event;
  accessPassType: Event["accessPassTypes"][number];
}) {
  const [state, setState] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);

  async function startAccessPass() {
    setState("creating");
    setMessage(null);
    setIntent(null);
    setTransaction(null);

    try {
      const result = await createEventAccessPassIntent(event.id, {
        accessPassTypeId: accessPassType.id
      });

      if (result.state === "approval_required") {
        setState("ready");
        setMessage("This Access Pass requires backend approval before payment or check-in.");
        return;
      }

      if (result.state === "free_granted") {
        setState("ready");
        setMessage("The backend granted this Access Pass. Refresh activity to see the pass projection.");
        return;
      }

      if (!result.paymentIntent) {
        throw new ApiMutationError("Access Pass payment was required but no payment intent was returned.");
      }

      const transactionRequest = await getPaymentTransactionRequest(result.paymentIntent.id);
      setIntent(result.paymentIntent);
      setTransaction(transactionRequest);
      setState("ready");
      setMessage("Open the wallet request. Event Access changes only after backend settlement verification.");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <article className="rounded border border-(--line) bg-(--background) p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{accessPassType.label}</p>
          <p className="mt-1 text-sm text-(--muted)">{accessPassType.remaining} remaining</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {accessPassType.state}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="Price" value={`${accessPassType.priceMinor?.toLocaleString() ?? "free"} ${accessPassType.currency}`} />
        <Fact label="Capacity" value={accessPassType.capacity.toString()} />
        <Fact label="Access" value={event.accessRule} />
      </div>
      <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-center text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === "creating" || accessPassType.state !== "active" || accessPassType.remaining <= 0}
          onClick={startAccessPass}
          type="button"
        >
          {state === "creating" ? "Creating Access Pass intent" : "Get Access Pass"}
        </button>

        {intent ? (
          <div className="grid gap-2 rounded border border-(--line) bg-(--panel) p-3 text-sm">
            <Fact label="Amount" value={`${intent.amountMinor.toLocaleString()} ${intent.currency}`} />
            <Fact label="Intent" value={intent.state} />
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
                : "border-(--line) bg-(--panel) text-(--muted)"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </article>
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
  return safeMutationMessage(error, "Access Pass");
}
