"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Conversation } from "@/api-client";
import {
  blockUser,
  createSafetyReport,
  markConversationRead,
  respondToMessageRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

export function ConversationStateActions({
  conversation,
  messagesVisible
}: {
  conversation: Conversation;
  messagesVisible: boolean;
}) {
  const router = useRouter();
  const readStarted = useRef(false);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [safetyAction, setSafetyAction] = useState<"block" | "report" | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    if (!messagesVisible || conversation.unreadCount < 1 || readStarted.current) return;
    readStarted.current = true;
    void markConversationRead(conversation.id).then(() => router.refresh()).catch(() => {
      readStarted.current = false;
    });
  }, [conversation.id, conversation.unreadCount, messagesVisible, router]);

  async function respond(action: "accept" | "decline") {
    setPending(action);
    setMessage(null);
    try {
      await respondToMessageRequest(conversation.id, { action });
      router.refresh();
    } catch (error) {
      setMessage(safeMutationMessage(error, "Message request"));
    } finally {
      setPending(null);
    }
  }

  async function blockCounterpart() {
    setSafetyAction("block");
    setMessage(null);
    try {
      await blockUser(conversation.counterpart.id, createMutationIdempotencyKey());
      setMessage("Account blocked. This conversation can no longer send or deliver messages.");
      router.refresh();
    } catch (error) {
      setMessage(safeMutationMessage(error, "Block account"));
    } finally {
      setSafetyAction(null);
    }
  }

  async function reportCounterpart() {
    const reason = reportReason.trim();
    if (reason.length < 3) return;
    setSafetyAction("report");
    setMessage(null);
    try {
      await createSafetyReport(
        { subjectType: "user", subjectId: conversation.counterpart.id, reason },
        createMutationIdempotencyKey()
      );
      setReportReason("");
      setShowReport(false);
      setMessage("Report submitted for safety review.");
    } catch (error) {
      setMessage(safeMutationMessage(error, "Report account"));
    } finally {
      setSafetyAction(null);
    }
  }

  return (
    <>
      {conversation.requestState !== "not_required" && conversation.requestState !== "accepted" ? (
        <div className="border-b border-(--line) bg-(--accent-soft) p-4 text-sm">
          {conversation.requestState === "pending" && conversation.requestRole === "recipient" ? (
            <>
              <p className="font-medium">Message request</p>
              <p className="mt-1 text-(--muted)">Accept to reply, or decline to close regular messaging.</p>
              <div className="mt-3 flex gap-2">
                <button className="primary-button" disabled={pending !== null} onClick={() => void respond("accept")} type="button">{pending === "accept" ? "Accepting" : "Accept"}</button>
                <button className="secondary-button" disabled={pending !== null} onClick={() => void respond("decline")} type="button">{pending === "decline" ? "Declining" : "Decline"}</button>
              </div>
            </>
          ) : conversation.requestState === "pending" ? (
            <p className="text-(--muted)">Request pending. You can send up to two regular messages; the recipient must accept before you can continue.</p>
          ) : (
            <p className="text-(--muted)">This message request was declined. Regular messaging is closed.</p>
          )}
        </div>
      ) : !conversation.canSend ? (
        <p className="border-b border-(--line) bg-(--accent-soft) p-4 text-sm text-(--muted)">
          Messaging is unavailable for this conversation.
        </p>
      ) : null}

      <section aria-label="Conversation safety" className="border-b border-(--line) p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-(--muted)">Safety controls for @{conversation.counterpart.handle}</p>
          <div className="flex gap-2">
            <button className="ghost-button" onClick={() => setShowReport((value) => !value)} type="button">
              Report
            </button>
            <button className="ghost-button" disabled={safetyAction !== null} onClick={() => void blockCounterpart()} type="button">
              {safetyAction === "block" ? "Blocking" : "Block"}
            </button>
          </div>
        </div>
        {showReport ? (
          <div className="mt-3 grid gap-2">
            <label className="grid gap-2">
              <span className="font-medium">Report reason</span>
              <textarea
                className="min-h-20 rounded border border-(--line) bg-(--background) p-3"
                maxLength={500}
                onChange={(event) => setReportReason(event.target.value)}
                value={reportReason}
              />
            </label>
            <button
              className="secondary-button justify-self-start"
              disabled={safetyAction !== null || reportReason.trim().length < 3}
              onClick={() => void reportCounterpart()}
              type="button"
            >
              {safetyAction === "report" ? "Submitting" : "Submit report"}
            </button>
          </div>
        ) : null}
        {message ? <p aria-live="polite" className="mt-2 text-(--muted)">{message}</p> : null}
      </section>
    </>
  );
}
