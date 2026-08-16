"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveChatMessage, LiveChatPage, LiveRoom } from "@/api-mutations";
import {
  ApiMutationError,
  createLiveChatMessage,
  createPaymentIntent,
  createSafetyReport,
  getLiveChatMessages
} from "@/api-mutations";
import { formatAssetAmount } from "@/format-asset-amount";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

const supportPresets = [500_000, 1_000_000, 2_000_000] as const;

export function LiveInteractionPanel({ initialMessages, room }: { initialMessages: LiveChatPage; room: LiveRoom }) {
  const [messages, setMessages] = useState<LiveChatMessage[]>(initialMessages.items);
  const [body, setBody] = useState("");
  const [amountMinor, setAmountMinor] = useState<number>(supportPresets[1]);
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMessages = useCallback(async () => {
    if (!room.chat.enabled || room.chat.accessState === "closed") return;
    try {
      const page = await getLiveChatMessages(room.id);
      setMessages(page.items);
    } catch {
      // Keep the last safe projection. The send action exposes actionable errors.
    }
  }, [room.chat.accessState, room.chat.enabled, room.id]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshMessages(), 5_000);
    return () => window.clearInterval(timer);
  }, [refreshMessages]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const created = await createLiveChatMessage(room.id, trimmed);
      setMessages((current) => [...current.filter((item) => item.id !== created.id), created]);
      setBody("");
    } catch (caught) {
      setError(apiMessage(caught, "Your message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function share() {
    const url = window.location.href;
    const canNativeShare = typeof navigator.share === "function";
    try {
      if (canNativeShare) await navigator.share({ title: room.title, url });
      else await navigator.clipboard.writeText(url);
      setNotice(canNativeShare ? "Shared" : "Link copied");
    } catch {
      setNotice(null);
    }
  }

  async function report(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await createSafetyReport({ reason: reportReason.trim(), subjectId: room.id, subjectType: "live_room" }, crypto.randomUUID());
      setReporting(false);
      setReportReason("");
      setNotice("Report sent to the safety team");
    } catch (caught) {
      setError(apiMessage(caught, "The report could not be sent."));
    }
  }

  const canChat = room.chat.enabled && room.chat.accessState === "allowed" && room.state === "live";

  return (
    <div className="grid gap-4">
      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Live chat</h2>
          <span className="text-xs text-(--muted)">{messages.length} messages</span>
        </div>
        <div aria-live="polite" className="mt-3 max-h-72 min-h-36 space-y-3 overflow-y-auto rounded border border-(--line) bg-(--background) p-3">
          {messages.length > 0 ? messages.map((message) => (
            <article className="text-sm" key={message.id}>
              <span className="font-semibold">@{message.author.handle}</span>{" "}
              <span className="break-words text-(--muted)">{message.body}</span>
            </article>
          )) : <p className="text-sm text-(--muted)">{room.chat.accessState === "members_only" ? "Chat is for active members." : room.chat.enabled ? "No messages yet." : "Chat is closed."}</p>}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={sendMessage}>
          <label className="sr-only" htmlFor="live-chat-message">Message</label>
          <input id="live-chat-message" className="min-h-11 min-w-0 flex-1 rounded border border-(--line) bg-(--background) px-3 text-sm" disabled={!canChat || sending} maxLength={500} onChange={(event) => setBody(event.currentTarget.value)} placeholder={canChat ? "Say something…" : "Chat is unavailable"} value={body} />
          <button className="rounded bg-(--foreground) px-4 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={!canChat || sending || body.trim().length === 0} type="submit">Send</button>
        </form>
      </section>

      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <h2 className="text-sm font-semibold">Support @{room.creator.handle}</h2>
        <p className="mt-1 text-xs leading-5 text-(--muted)">Voluntary support does not buy access, visibility, or priority.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {supportPresets.map((preset) => (
            <button className={`rounded border px-2 py-2 text-sm ${amountMinor === preset ? "border-(--accent) bg-(--accent-soft)" : "border-(--line)"}`} key={preset} onClick={() => setAmountMinor(preset)} type="button">{formatAssetAmount(preset, "USDC")}</button>
          ))}
        </div>
        <div className="mt-3">
          <PaymentHandoffPanel
            createIntent={(idempotencyKey) => createPaymentIntent({ amountMinor, currency: "USDC", productType: "support", targetId: room.creator.id }, idempotencyKey)}
            ctaLabel="Support creator"
            idleCopy="Approve once in your wallet. We confirm settlement before recording support."
            pendingLabel="Preparing support"
            readyCopy="Open the wallet request to continue."
          />
        </div>
      </section>

      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="flex gap-2">
          <button className="min-h-10 flex-1 rounded border border-(--line) px-3 text-sm font-semibold" onClick={share} type="button">Share</button>
          <button className="min-h-10 flex-1 rounded border border-(--line) px-3 text-sm font-semibold" onClick={() => setReporting((value) => !value)} type="button">Report</button>
        </div>
        {reporting ? (
          <form className="mt-3 grid gap-2" onSubmit={report}>
            <label className="text-sm font-medium" htmlFor="live-report-reason">What happened?</label>
            <textarea id="live-report-reason" className="min-h-20 rounded border border-(--line) bg-(--background) p-3 text-sm" maxLength={500} minLength={3} onChange={(event) => setReportReason(event.currentTarget.value)} required value={reportReason} />
            <button className="min-h-10 rounded bg-(--foreground) px-3 text-sm font-semibold text-(--background)" type="submit">Send report</button>
          </form>
        ) : null}
        {notice ? <p className="mt-3 text-sm text-(--muted)" role="status">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm font-medium text-red-400" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function apiMessage(caught: unknown, fallback: string) {
  return caught instanceof ApiMutationError || caught instanceof Error ? caught.message : fallback;
}
