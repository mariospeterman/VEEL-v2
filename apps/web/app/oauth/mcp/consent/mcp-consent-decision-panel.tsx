"use client";

import { useState } from "react";
import { approveMcpConsentRequest, denyMcpConsentRequest } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

type DecisionState = "idle" | "approving" | "denying" | "failed";

export function McpConsentDecisionPanel({ requestId }: { requestId: string }) {
  const [state, setState] = useState<DecisionState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const working = state === "approving" || state === "denying";

  async function decide(decision: "approve" | "deny") {
    setState(decision === "approve" ? "approving" : "denying");
    setMessage(null);

    try {
      const result =
        decision === "approve"
          ? await approveMcpConsentRequest(requestId)
          : await denyMcpConsentRequest(requestId);
      window.location.assign(result.redirectUri);
    } catch (error) {
      setState("failed");
      setMessage(safeMutationMessage(error, "MCP consent decision"));
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-4">
      <p className="text-sm text-(--muted)">
        {message ?? "Approve only if you initiated this connector from your MCP client."}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={working}
          onClick={() => void decide("deny")}
          type="button"
        >
          Deny
        </button>
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-medium text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={working}
          onClick={() => void decide("approve")}
          type="button"
        >
          {state === "approving" ? "Approving" : "Approve"}
        </button>
      </div>
    </div>
  );
}
