"use client";

import { useRef, useState } from "react";
import type { Conversation } from "@/api-client";
import {
  ApiMutationError,
  createMessage,
  createPaidMessageIntent,
  type Message
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface MessageComposerProps {
  conversation: Conversation;
}

export function MessageComposer({ conversation }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "payment" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<Message | null>(null);
  const messageAttempt = useRef<{ body: string; idempotencyKey: string } | null>(null);
  const trimmedBody = body.trim();
  const isBusy = state === "sending" || state === "payment";

  async function sendVisibleMessage() {
    if (!trimmedBody) return;
    resetResult("sending");

    try {
      const idempotencyKey = idempotencyKeyForBody(messageAttempt, trimmedBody);
      const created = await createMessage(conversation.id, { body: trimmedBody }, idempotencyKey);
      messageAttempt.current = null;
      setSentMessage(created);
      setBody("");
      setState("ready");
      setMessage("Message was accepted by the backend conversation policy.");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  async function startPaidMessage(checkoutIdempotencyKey: string) {
    if (!trimmedBody) return null;
    resetResult("payment");

    try {
      const result = await createPaidMessageIntent(
        conversation.id,
        { body: trimmedBody },
        checkoutIdempotencyKey
      );

      if (result.state === "already_delivered") {
        setSentMessage(result.message ?? null);
        setBody("");
        setState("ready");
        setMessage("Paid message delivery is already reflected by the backend projection.");
        return null;
      }

      if (!result.paymentIntent) {
        throw new ApiMutationError("Paid message requires payment but no payment intent was returned.");
      }

      setState("idle");
      return result.paymentIntent;
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
      throw error;
    }
  }

  function resetResult(nextState: "sending" | "payment") {
    setState(nextState);
    setMessage(null);
    setSentMessage(null);
  }

  return (
    <section className="border-t border-(--line) p-4">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Composer</span>
        <textarea
          className="min-h-28 resize-none rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)"
          maxLength={4000}
          disabled={
            !conversation.canSend &&
            !(conversation.requestState === "pending" && conversation.requestRole === "initiator")
          }
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message..."
          value={body}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy || !trimmedBody || !conversation.canSend}
          onClick={sendVisibleMessage}
          type="button"
        >
          {state === "sending" ? "Sending" : "Send"}
        </button>
      </div>
      <div className="mt-3">
        <PaymentHandoffPanel
          createIntent={startPaidMessage}
          ctaLabel="Send as paid message"
          disabled={
            isBusy || !trimmedBody || conversation.requestState === "declined" ||
            (conversation.requestState === "pending" && conversation.requestRole === "recipient")
          }
          idleCopy="Paid delivery uses the same review, consent, wallet approval, and backend settlement flow as other one-time products."
          pendingLabel="Preparing paid message"
          readyCopy="Paid message delivery is reflected by the backend conversation projection."
        />
      </div>

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

function errorMessage(error: unknown) {
  return safeMutationMessage(error, "Message action");
}

function idempotencyKeyForBody(
  attempt: { current: { body: string; idempotencyKey: string } | null },
  body: string
) {
  if (attempt.current?.body === body) {
    return attempt.current.idempotencyKey;
  }

  const idempotencyKey = createMutationIdempotencyKey();
  attempt.current = { body, idempotencyKey };
  return idempotencyKey;
}
