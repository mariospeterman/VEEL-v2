"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import {
  ApiMutationError,
  createMessage,
  type CreateMessageRequest,
  type Message
} from "@/api-mutations";
import {
  claimOfflineMessageDelivery,
  claimOfflineMessageSession,
  classifyMessageFailure,
  createOfflineMessage,
  enqueueOfflineMessage,
  isOfflineMessageStorageKeyForScope,
  readOfflineMessages,
  removeOfflineMessage,
  updateOfflineMessage,
  type OfflineMessageRecord,
  type OfflineMessageScope
} from "@/messages/offline-message-queue";

interface MessageComposerProps {
  actorUserId: string | null;
  clientSessionScope: string | null;
  conversation: Conversation;
  initialSharedContentItemId: string | null;
  replyTo: Message | null;
  onClearReply: () => void;
  onTyping: (active: boolean) => void;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxAutomaticAttempts = 5;

export function MessageComposer({
  actorUserId,
  clientSessionScope,
  conversation,
  initialSharedContentItemId,
  replyTo,
  onClearReply,
  onTyping
}: MessageComposerProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "queued" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sharedContentItemId, setSharedContentItemId] = useState(
    initialSharedContentItemId && uuidPattern.test(initialSharedContentItemId) ? initialSharedContentItemId : ""
  );
  const [attachmentIds, setAttachmentIds] = useState("");
  const [browserTabId, setBrowserTabId] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OfflineMessageRecord[]>([]);
  const [queueRevision, setQueueRevision] = useState(0);
  const flushInFlight = useRef(false);
  const activeFlush = useRef<AbortController | null>(null);
  const deliveryLeaseOwnerId = useRef<string | null>(null);
  const trimmedBody = body.trim();

  useEffect(() => {
    if (!actorUserId || !clientSessionScope) {
      setBrowserTabId(null);
      setOutbox([]);
      return;
    }
    deliveryLeaseOwnerId.current ??= crypto.randomUUID();
    const nextBrowserTabId = claimOfflineMessageSession(
      window.localStorage,
      window.sessionStorage,
      actorUserId,
      clientSessionScope
    );
    setBrowserTabId(nextBrowserTabId);
  }, [actorUserId, clientSessionScope]);

  useEffect(() => {
    if (!actorUserId || !clientSessionScope || !browserTabId || !deliveryLeaseOwnerId.current) return;
    const scope: OfflineMessageScope = {
      actorUserId,
      clientSessionScope,
      browserTabId,
      conversationId: conversation.id
    };
    const leaseOwnerId = deliveryLeaseOwnerId.current;
    let disposed = false;

    const syncOutbox = () => {
      if (!disposed) setOutbox(readOfflineMessages(window.localStorage, scope));
    };
    const flush = async () => {
      if (disposed || !navigator.onLine || flushInFlight.current) return;
      flushInFlight.current = true;
      try {
        const now = Date.now();
        const queued = readOfflineMessages(window.localStorage, scope).filter((item) =>
          ["queued", "retrying", "sending"].includes(item.state) &&
          (item.nextAttemptAt === null || Date.parse(item.nextAttemptAt) <= now)
        );
        for (const item of queued) {
          if (disposed || !navigator.onLine) break;
          const sending = claimOfflineMessageDelivery(
            window.localStorage,
            scope,
            item.clientMessageId,
            leaseOwnerId
          );
          if (!sending) continue;
          syncOutbox();

          const controller = new AbortController();
          activeFlush.current = controller;
          const timeout = window.setTimeout(() => controller.abort(), 10_000);
          try {
            await createMessage(
              sending.conversationId,
              sending.request,
              sending.idempotencyKey,
              actorUserId,
              controller.signal
            );
            removeOfflineMessage(window.localStorage, scope, item.clientMessageId);
            setState("ready");
            setMessage("Message sent.");
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["messages", "conversation", sending.conversationId] }),
              queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] })
            ]);
          } catch (error) {
            if (disposed || controller.signal.aborted && !navigator.onLine) break;
            const disposition = classifyMessageFailure(error instanceof ApiMutationError ? error.status : undefined);
            const attemptCount = sending.attemptCount + 1;
            const retryable = disposition === "auto_retry" && attemptCount < maxAutomaticAttempts;
            const failed: OfflineMessageRecord = {
              ...sending,
              attemptCount,
              state: disposition === "pause_auth"
                ? "paused_auth"
                : disposition === "manual_attention"
                  ? "needs_attention"
                  : retryable
                    ? "retrying"
                    : "retryable_failed",
              lastFailureKind: disposition === "pause_auth"
                ? "authentication"
                : disposition === "manual_attention"
                  ? "request"
                  : "transport",
              nextAttemptAt: retryable
                ? new Date(Date.now() + retryDelayMs(attemptCount)).toISOString()
                : null,
              deliveryLeaseOwnerId: null,
              deliveryLeaseExpiresAt: null
            };
            updateOfflineMessage(window.localStorage, scope, failed);
            setState(disposition === "auto_retry" ? "queued" : "error");
            setMessage(
              disposition === "pause_auth"
                ? "Sign in again before retrying this queued message."
                : disposition === "manual_attention"
                  ? "This message needs your attention before retrying."
                  : "Message delivery will retry safely with the same request key."
            );
          } finally {
            window.clearTimeout(timeout);
            if (activeFlush.current === controller) activeFlush.current = null;
            syncOutbox();
          }
        }
      } finally {
        flushInFlight.current = false;
        syncOutbox();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (!isOfflineMessageStorageKeyForScope(event.key, scope)) return;
      syncOutbox();
      void flush();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    const interval = window.setInterval(() => void flush(), 2_000);
    window.addEventListener("online", flush);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    syncOutbox();
    void flush();

    return () => {
      disposed = true;
      activeFlush.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", flush);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [actorUserId, browserTabId, clientSessionScope, conversation.id, queryClient, queueRevision]);

  function currentScope(): OfflineMessageScope | null {
    return actorUserId && clientSessionScope && browserTabId
      ? { actorUserId, clientSessionScope, browserTabId, conversationId: conversation.id }
      : null;
  }

  function sendVisibleMessage() {
    if (!trimmedBody) return;
    const scope = currentScope();
    if (!scope) {
      setState("error");
      setMessage("Reload messages after signing in before sending.");
      return;
    }
    setState("sending");
    setMessage(null);
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
    const queued = createOfflineMessage(scope, request);
    if (!enqueueOfflineMessage(window.localStorage, queued)) {
      setState("error");
      setMessage("This device outbox is full. Retry or cancel an older message before sending another.");
      return;
    }

    setOutbox(readOfflineMessages(window.localStorage, scope));
    clearComposer();
    setState(navigator.onLine ? "sending" : "queued");
    setMessage(navigator.onLine
      ? "Sending from the protected outbox."
      : "Message is queued on this device and will retry when the connection returns.");
    setQueueRevision((revision) => revision + 1);
  }

  function retryQueued(item: OfflineMessageRecord) {
    const scope = currentScope();
    if (!scope) return;
    updateOfflineMessage(window.localStorage, scope, {
      ...item,
      state: "queued",
      attemptCount: 0,
      nextAttemptAt: new Date().toISOString(),
      lastFailureKind: null,
      deliveryLeaseOwnerId: null,
      deliveryLeaseExpiresAt: null
    });
    setQueueRevision((revision) => revision + 1);
  }

  function cancelQueued(item: OfflineMessageRecord) {
    const scope = currentScope();
    if (!scope) return;
    removeOfflineMessage(window.localStorage, scope, item.clientMessageId);
    setOutbox(readOfflineMessages(window.localStorage, scope));
  }

  function clearComposer() {
    setBody("");
    setSharedContentItemId("");
    setAttachmentIds("");
    onClearReply();
  }

  return (
    <section className="border-t border-(--line) p-4">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Composer</span>
        <textarea
          className="min-h-28 resize-none rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)"
          maxLength={4000}
          disabled={!conversation.canSend}
          onBlur={() => onTyping(false)}
          onChange={(event) => { setBody(event.target.value); onTyping(event.target.value.trim().length > 0); }}
          placeholder="Write a message..."
          value={body}
        />
      </label>
      {sharedContentItemId ? (
        <p className="mt-2 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm text-(--muted)" role="status">
          Post added to this message draft. Add a message, review it, then select Send. Nothing is delivered until sending succeeds.
        </p>
      ) : null}
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
          disabled={!trimmedBody || !conversation.canSend || !actorUserId || !clientSessionScope || !browserTabId}
          onClick={sendVisibleMessage}
          type="button"
        >
          Send
        </button>
      </div>

      {outbox.length > 0 ? (
        <div className="mt-3 grid gap-2" aria-label="Message outbox">
          {outbox.map((item) => (
            <article className="rounded border border-(--line) bg-(--background) px-3 py-2 text-sm" key={item.clientMessageId}>
              <p className="line-clamp-2">{item.request.body}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-(--muted)">
                <span>{outboxLabel(item)}</span>
                <span className="flex gap-2">
                  {["paused_auth", "needs_attention", "retryable_failed"].includes(item.state) ? (
                    <button className="underline" onClick={() => retryQueued(item)} type="button">Retry</button>
                  ) : null}
                  <button className="underline" onClick={() => cancelQueued(item)} type="button">Cancel</button>
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {message ? (
        <p className={`mt-3 rounded border px-3 py-2 text-sm ${
          state === "error"
            ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
            : "border-(--line) bg-(--background) text-(--muted)"
        }`}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

function retryDelayMs(attemptCount: number): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attemptCount - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function outboxLabel(item: OfflineMessageRecord): string {
  switch (item.state) {
    case "sending": return "Sending";
    case "queued": return "Queued on this device";
    case "retrying": return `Retrying · attempt ${item.attemptCount}`;
    case "paused_auth": return "Paused until you sign in again";
    case "needs_attention": return "Needs attention";
    case "retryable_failed": return "Automatic retries paused";
  }
}
