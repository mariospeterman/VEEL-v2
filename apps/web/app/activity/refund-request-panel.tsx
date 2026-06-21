"use client";

import { useState, useTransition } from "react";
import {
  createRefundDisputeRequest,
  type CreateRefundDisputeRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

interface RefundRequestPanelProps {
  paymentIntentId: string;
  latestRefundRequestState?: string | null | undefined;
}

export function RefundRequestPanel({
  paymentIntentId,
  latestRefundRequestState
}: RefundRequestPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(
    latestRefundRequestState ? `Review request: ${latestRefundRequestState}` : null
  );

  function submit(formData: FormData) {
    const reason = formData.get("reason");
    const kind = formData.get("kind");
    const requestedAction = formData.get("requestedAction");

    if (typeof reason !== "string" || reason.trim().length < 10) {
      setMessage("Please describe the issue in at least 10 characters.");
      return;
    }

    const body: CreateRefundDisputeRequest = {
      paymentIntentId,
      kind: kind === "refund_request" || kind === "dispute" ? kind : "access_issue",
      requestedAction:
        requestedAction === "creator_refund" ||
        requestedAction === "revoke_access" ||
        requestedAction === "replacement_access"
          ? requestedAction
          : "review_only",
      reason: reason.trim()
    };

    startTransition(async () => {
      try {
        const created = await createRefundDisputeRequest(body);
        setMessage(`Review request opened: ${created.state}`);
      } catch (error) {
        setMessage(safeMutationMessage(error, "Review request"));
      }
    });
  }

  return (
    <form action={submit} className="mt-4 grid gap-3 border-t border-(--line) pt-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase text-(--muted)">Issue</span>
          <select
            className="rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
            defaultValue="access_issue"
            name="kind"
          >
            <option value="access_issue">Access issue</option>
            <option value="refund_request">Refund review</option>
            <option value="dispute">Dispute</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase text-(--muted)">Request</span>
          <select
            className="rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
            defaultValue="review_only"
            name="requestedAction"
          >
            <option value="review_only">Review only</option>
            <option value="replacement_access">Replacement access</option>
            <option value="creator_refund">Creator refund review</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="text-xs uppercase text-(--muted)">Reason</span>
        <textarea
          className="min-h-20 resize-y rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
          maxLength={1000}
          minLength={10}
          name="reason"
          placeholder="Describe non-delivery, duplicate payment, technical failure, fraud, misdescription, or another legal/policy exception."
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Opening..." : "Open review"}
        </button>
        {message ? <p className="text-sm text-(--muted)">{message}</p> : null}
      </div>
    </form>
  );
}
