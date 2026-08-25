"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import {
  createMessage,
  type CreateMessageRequest,
  type Message
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

interface MessageComposerProps {
  conversation: Conversation;
  initialSharedContentItemId: string | null;
  replyTo: Message | null;
  onClearReply: () => void;
  onTyping: (active: boolean) => void;
}

interface QueuedMessage {
  conversationId: string;
  optimisticId: string;
  idempotencyKey: string;
  request: CreateMessageRequest;
  createdAt: string;
}

const offlineQueueKey = "wevid:message-offline-queue:v1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function MessageComposer({ conversation, initialSharedContentItemId, replyTo, onClearReply, onTyping }: MessageComposerProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "queued" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<Message | null>(null);
  const [sharedContentItemId, setSharedContentItemId] = useState(
    initialSharedContentItemId && uuidPattern.test(initialSharedContentItemId) ? initialSharedContentItemId : ""
  );
  const [attachmentIds, setAttachmentIds] = useState("");
  const messageAttempt = useRef<{ requestHash: string; idempotencyKey: string } | null>(null);
  const trimmedBody = body.trim();
  const isBusy = state === "sending";

  useEffect(() => {
    const flush = async () => {
      if (!navigator.onLine) return;
      const queued = readQueue().filter((item) => item.conversationId === conversation.id);
      for (const item of queued) {
        try {
          const created = await createMessage(item.conversationId, item.request, item.idempotencyKey);
          removeQueued(item.idempotencyKey);
          queryClient.setQueryData<{ items: Message[] }>(
            ["messages", "conversation", item.conversationId],
            (current) => ({
              items: (current?.items ?? []).map((message) => message.id === item.optimisticId ? created : message)
            })
          );
        } catch {
          if (!navigator.onLine) return;
          removeQueued(item.idempotencyKey);
          queryClient.setQueryData<{ items: Message[] }>(
            ["messages", "conversation", item.conversationId],
            (current) => ({ items: (current?.items ?? []).filter((message) => message.id !== item.optimisticId) })
          );
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
    };
    for (const item of readQueue().filter((queued) => queued.conversationId === conversation.id)) {
      queryClient.setQueryData<{ items: Message[] }>(
        ["messages", "conversation", conversation.id],
        (current) => current?.items.some((message) => message.id === item.optimisticId)
          ? current
          : { items: [...(current?.items ?? []), optimisticMessage(item)] }
      );
    }
    window.addEventListener("online", flush);
    void flush();
    return () => window.removeEventListener("online", flush);
  }, [conversation.id, queryClient]);

  async function sendVisibleMessage() {
    if (!trimmedBody) return;
    resetResult("sending");
    const optimisticId = `optimistic-${Date.now()}`;
    const parsedAttachments = attachmentIds.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    if (parsedAttachments.length > 4 || new Set(parsedAttachments).size !== parsedAttachments.length || parsedAttachments.some((id) => !uuidPattern.test(id))) {
      setState("error");
      setMessage("Use up to four unique approved content IDs for attachments.");
      return;
    }
    if (sharedContentItemId.trim() && !uuidPattern.test(sharedContentItemId.trim())) {
      setState("error");
      setMessage("The shared content ID must be a valid WeVid content ID.");
      return;
    }
    const request: CreateMessageRequest = {
      body: trimmedBody,
      replyToMessageId: replyTo?.id ?? null,
      sharedContentItemId: sharedContentItemId.trim() || null,
      attachmentContentItemIds: parsedAttachments
    };
    const idempotencyKey = idempotencyKeyForRequest(messageAttempt, request);
    const queued: QueuedMessage = { conversationId: conversation.id, optimisticId, idempotencyKey, request, createdAt: new Date().toISOString() };
    const optimistic = optimisticMessage(queued);
    const queryKey = ["messages", "conversation", conversation.id] as const;
    queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
      items: [...(current?.items ?? []), optimistic]
    }));

    if (!navigator.onLine) {
      enqueue(queued);
      clearComposer();
      setState("queued");
      setMessage("Message is queued on this device and will retry when the connection returns.");
      return;
    }

    try {
      const created = await createMessage(conversation.id, request, idempotencyKey);
      messageAttempt.current = null;
      setSentMessage(created);
      queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
        items: (current?.items ?? []).map((item) => item.id === optimisticId ? created : item)
      }));
      void queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
      clearComposer();
      setState("ready");
      setMessage("Message sent.");
    } catch (error) {
      if (!navigator.onLine) {
        enqueue(queued);
        clearComposer();
        setState("queued");
        setMessage("Message is queued on this device and will retry when the connection returns.");
        return;
      }
      queryClient.setQueryData<{ items: Message[] }>(queryKey, (current) => ({
        items: (current?.items ?? []).filter((item) => item.id !== optimisticId)
      }));
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  function clearComposer() {
    setBody("");
    setSharedContentItemId("");
    setAttachmentIds("");
    onClearReply();
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
          onBlur={() => onTyping(false)}
          onChange={(event) => { setBody(event.target.value); onTyping(event.target.value.trim().length > 0); }}
          placeholder="Write a message..."
          value={body}
        />
      </label>
      {replyTo ? (
        <div className="mt-2 flex items-center justify-between rounded border border-(--line) px-3 py-2 text-xs text-(--muted)">
          <span>Replying to {replyTo.sender.displayName}: {replyTo.body.slice(0, 80)}</span>
          <button className="underline" onClick={onClearReply} type="button">Cancel</button>
        </div>
      ) : null}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-(--muted)">Share approved WeVid media</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" placeholder="Existing content ID to share" value={sharedContentItemId} onChange={(event) => setSharedContentItemId(event.target.value)} />
          <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" placeholder="Your approved attachment IDs (up to 4)" value={attachmentIds} onChange={(event) => setAttachmentIds(event.target.value)} />
        </div>
        <p className="mt-1 text-xs text-(--muted)">Attachments must already have passed the existing media moderation and exact-revision release pipeline.</p>
      </details>
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
        <p className="mt-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm text-(--muted)">{sentMessage.deliveryState === "visible" ? "Delivered" : "Sending safely"}</p>
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

function idempotencyKeyForRequest(
  attempt: { current: { requestHash: string; idempotencyKey: string } | null },
  request: CreateMessageRequest
) {
  const requestHash = JSON.stringify(request);
  if (attempt.current?.requestHash === requestHash) {
    return attempt.current.idempotencyKey;
  }

  const idempotencyKey = createMutationIdempotencyKey();
  attempt.current = { requestHash, idempotencyKey };
  return idempotencyKey;
}

function optimisticMessage(item: QueuedMessage): Message {
  return {
    id: item.optimisticId,
    conversationId: item.conversationId,
    sender: { id: "current-user", handle: "you", displayName: "You", avatarUrl: null, badges: [] },
    body: item.request.body,
    deliveryState: "visible",
    paymentIntentId: null,
    replyToMessageId: item.request.replyToMessageId ?? null,
    sharedContentItemId: item.request.sharedContentItemId ?? null,
    attachments: [],
    reactions: [],
    createdAt: item.createdAt
  };
}

function readQueue(): QueuedMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(offlineQueueKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is QueuedMessage => Boolean(
      item && typeof item === "object" &&
      typeof (item as QueuedMessage).conversationId === "string" &&
      typeof (item as QueuedMessage).idempotencyKey === "string" &&
      typeof (item as QueuedMessage).request?.body === "string"
    )).slice(-25);
  } catch {
    return [];
  }
}

function enqueue(item: QueuedMessage) {
  const queue = readQueue();
  if (!queue.some((queued) => queued.idempotencyKey === item.idempotencyKey)) queue.push(item);
  window.localStorage.setItem(offlineQueueKey, JSON.stringify(queue.slice(-25)));
}

function removeQueued(idempotencyKey: string) {
  window.localStorage.setItem(offlineQueueKey, JSON.stringify(readQueue().filter((item) => item.idempotencyKey !== idempotencyKey)));
}
