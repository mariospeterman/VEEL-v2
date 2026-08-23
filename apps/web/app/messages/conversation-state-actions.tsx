"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import {
  blockUser,
  createSafetyReport,
  markConversationRead,
  respondToMessageRequest,
  updateConversationMute
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
  const queryClient = useQueryClient();
  const readStarted = useRef(false);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [safetyAction, setSafetyAction] = useState<"block" | "report" | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    if (!messagesVisible || conversation.requestState === "pending" || conversation.unreadCount < 1 || readStarted.current) return;
    readStarted.current = true;
    void markConversationRead(conversation.id).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["messages", "conversations"] });
    }).catch(() => {
      readStarted.current = false;
    });
  }, [conversation.id, conversation.requestState, conversation.unreadCount, messagesVisible, queryClient]);

  async function respond(action: "accept" | "decline") {
    setPending(action);
    setMessage(null);
    try {
      const updated = await respondToMessageRequest(conversation.id, { action });
      queryClient.setQueryData<{ items: Conversation[] }>(["messages", "conversations"], (current) => ({
        items: (current?.items ?? []).map((item) => item.id === updated.id ? updated : item)
      }));
      void queryClient.invalidateQueries({ queryKey: ["messages", "conversation", conversation.id] });
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
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    } catch (error) {
      setMessage(safeMutationMessage(error, "Block account"));
    } finally {
      setSafetyAction(null);
    }
  }

  async function toggleMute() {
    setMessage(null);
    try {
      const updated = await updateConversationMute(conversation.id, { muted: !conversation.muted });
      queryClient.setQueryData<{ items: Conversation[] }>(["messages", "conversations"], (current) => ({
        items: (current?.items ?? []).map((item) => item.id === updated.id ? updated : item)
      }));
      setMessage(updated.muted ? "Conversation notifications muted." : "Conversation notifications enabled.");
    } catch (error) {
      setMessage(safeMutationMessage(error, "Conversation notifications"));
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
            <p className="text-(--muted)">Request pending. Your single introduction was sent; the recipient must accept before the conversation can continue.</p>
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
            <button className="ghost-button" onClick={() => void toggleMute()} type="button">
              {conversation.muted ? "Unmute" : "Mute"}
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
