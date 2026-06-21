"use client";

import { useState } from "react";
import {
  getPaymentTransactionRequest,
  type PaymentIntent,
  type TransactionRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

interface PaymentHandoffPanelProps {
  createIntent: () => Promise<PaymentIntent | null>;
  ctaLabel: string;
  disabled?: boolean;
  idleCopy: string;
  pendingLabel?: string;
  readyCopy: string;
}

export function PaymentHandoffPanel({
  createIntent,
  ctaLabel,
  disabled = false,
  idleCopy,
  pendingLabel = "Creating intent",
  readyCopy
}: PaymentHandoffPanelProps) {
  const [state, setState] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);

  async function startPayment() {
    setState("creating");
    setMessage(null);
    setIntent(null);
    setTransaction(null);

    try {
      const paymentIntent = await createIntent();

      if (!paymentIntent) {
        setState("ready");
        setMessage(readyCopy);
        return;
      }

      const transactionRequest = await getPaymentTransactionRequest(paymentIntent.id);
      setIntent(paymentIntent);
      setTransaction(transactionRequest);
      setState("ready");
      setMessage(readyCopy);
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm leading-6 text-(--muted)">{message ?? idleCopy}</p>
      <button
        className="rounded bg-(--foreground) px-3 py-2 text-center text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || state === "creating"}
        onClick={startPayment}
        type="button"
      >
        {state === "creating" ? pendingLabel : ctaLabel}
      </button>

      {intent ? (
        <div className="grid gap-2 rounded border border-(--line) bg-(--background) p-3 text-sm">
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

      {message && state === "error" ? (
        <p className="rounded border border-[#7f1d1d] bg-[#450a0a] px-3 py-2 text-sm text-[#fecaca]">
          {message}
        </p>
      ) : null}
    </div>
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
  return safeMutationMessage(error, "Payment");
}
