"use client";

import { useState } from "react";
import type { Conversation } from "@/api-client";
import {
  ApiMutationError,
  createMessage,
  createPaidMessageIntent,
  getPaymentTransactionRequest,
  type Message,
  type PaymentIntent,
  type TransactionRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { formatAssetAmount } from "@/format-asset-amount";

interface MessageComposerProps {
  conversation: Conversation;
}

export function MessageComposer({ conversation }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "payment" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<Message | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);
  const trimmedBody = body.trim();
  const isBusy = state === "sending" || state === "payment";

  async function sendVisibleMessage() {
    if (!trimmedBody) return;
    resetResult("sending");

    try {
      const created = await createMessage(conversation.id, { body: trimmedBody });
      setSentMessage(created);
      setBody("");
      setState("ready");
      setMessage("Message was accepted by the backend conversation policy.");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  async function startPaidMessage() {
    if (!trimmedBody) return;
    resetResult("payment");

    try {
      const result = await createPaidMessageIntent(conversation.id, { body: trimmedBody });

      if (result.state === "already_delivered") {
        setSentMessage(result.message ?? null);
        setBody("");
        setState("ready");
        setMessage("Paid message delivery is already reflected by the backend projection.");
        return;
      }

      if (!result.paymentIntent) {
        throw new ApiMutationError("Paid message requires payment but no payment intent was returned.");
      }

      const transactionRequest = await getPaymentTransactionRequest(result.paymentIntent.id);
      setIntent(result.paymentIntent);
      setTransaction(transactionRequest);
      setState("ready");
      setMessage("Open the wallet request. Paid message delivery changes only after backend settlement verification.");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  function resetResult(nextState: "sending" | "payment") {
    setState(nextState);
    setMessage(null);
    setSentMessage(null);
    setIntent(null);
    setTransaction(null);
  }

  return (
    <section className="border-t border-(--line) p-4">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Composer</span>
        <textarea
          className="min-h-28 resize-none rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)"
          maxLength={4000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message..."
          value={body}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy || !trimmedBody}
          onClick={sendVisibleMessage}
          type="button"
        >
          {state === "sending" ? "Sending" : "Send"}
        </button>
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-semibold text-(--foreground) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy || !trimmedBody}
          onClick={startPaidMessage}
          type="button"
        >
          {state === "payment" ? "Creating intent" : "Create paid message intent"}
        </button>
      </div>

      {intent ? (
        <div className="mt-3 grid gap-2 rounded border border-(--line) bg-(--background) p-3 text-sm">
          <Fact label="Amount" value={formatAssetAmount(intent.amountMinor, intent.currency)} />
          <Fact label="Intent" value={intent.state} />
        </div>
      ) : null}

      {transaction ? (
        <a
          className="mt-3 block rounded border border-(--line) px-3 py-2 text-center text-sm font-semibold text-(--foreground)"
          href={transaction.transactionRequestUrl}
        >
          Open wallet request
        </a>
      ) : null}

      {sentMessage ? (
        <p className="mt-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm text-(--muted)">
          Latest backend delivery state: {sentMessage.deliveryState}
        </p>
      ) : null}

      {message ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            state === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--background) text-(--muted)"
          }`}
        >
          {message}
        </p>
      ) : null}
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
  return safeMutationMessage(error, "Message action");
}
