"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import {
  createMessage,
  type Message
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

interface MessageComposerProps {
  conversation: Conversation;
}

export function MessageComposer({ conversation }: MessageComposerProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<Message | null>(null);
  const messageAttempt = useRef<{ body: string; idempotencyKey: string } | null>(null);
  const trimmedBody = body.trim();
  const isBusy = state === "sending";

  async function sendVisibleMessage() {
    if (!trimmedBody) return;
    resetResult("sending");
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      conversationId: conversation.id,
      sender: { id: "current-user", handle: "you", displayName: "You", avatarUrl: null, badges: [] },
      body: trimmedBody,
      deliveryState: "visible",
      paymentIntentId: null,
      replyToMessageId: null,
      sharedContentItemId: null,
      reactions: [],
      createdAt: new Date().toISOString()
    };
    const queryKey = ["messages", "conversation", conversation.id] as const;
    queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
      items: [...(current?.items ?? []), optimistic]
    }));

    try {
      const idempotencyKey = idempotencyKeyForBody(messageAttempt, trimmedBody);
      const created = await createMessage(conversation.id, { body: trimmedBody }, idempotencyKey);
      messageAttempt.current = null;
      setSentMessage(created);
      queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
        items: (current?.items ?? []).map((item) => item.id === optimisticId ? created : item)
      }));
      void queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
      setBody("");
      setState("ready");
      setMessage("Message was accepted by the backend conversation policy.");
    } catch (error) {
      queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
        items: (current?.items ?? []).filter((item) => item.id !== optimisticId)
      }));
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  function resetResult(nextState: "sending") {
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
