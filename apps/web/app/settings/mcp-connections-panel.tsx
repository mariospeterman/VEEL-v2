"use client";

import { useState } from "react";
import { ApiMutationError, revokeMcpConnection } from "@/api-mutations";
import type { ApiResult, McpConnectionPage } from "@/api-client";
import { mapApiFailure } from "@/api-errors";

export function McpConnectionsPanel({ connections }: { connections: ApiResult<McpConnectionPage> }) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  if (!connections.ok) {
    const mapped = mapApiFailure(connections, "Connected AI / MCP");
    return (
      <div className="rounded border border-(--line) bg-(--background) p-3 text-sm">
        <p className="font-medium">Connected AI / MCP</p>
        <p className="mt-1 text-(--muted)">{mapped.message}</p>
      </div>
    );
  }

  async function revoke(connectionId: string) {
    setRevokingId(connectionId);
    setMessage(null);
    try {
      await revokeMcpConnection(connectionId);
      setRevokedIds((current) => new Set([...current, connectionId]));
    } catch (error) {
      setMessage(error instanceof ApiMutationError ? error.message : "MCP connector revocation failed.");
    } finally {
      setRevokingId(null);
    }
  }

  const items = connections.data.items;

  return (
    <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div>
        <p className="font-medium">Connected AI / MCP</p>
        <p className="mt-1 text-(--muted)">
          {message ?? `${items.length} connector${items.length === 1 ? "" : "s"}. External clients bring their own AI/LLM.`}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-(--muted)">
          No active external MCP connectors. OAuth client registration is still an operator-controlled staging step.
        </p>
      ) : (
        <div className="grid gap-2">
          {items.map((connection) => {
            const state = revokedIds.has(connection.id) ? "revoked" : connection.state;
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-3"
                key={connection.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">{connection.clientName}</p>
                  <p className="mt-1 text-(--muted)">
                    {connection.authMode} / {connection.roleType} / {state}
                  </p>
                  <p className="mt-1 truncate text-xs text-(--muted)">{connection.scopes.join(" ")}</p>
                  <p className="mt-1 text-xs text-(--muted)">
                    Last used: {connection.lastUsedAt ?? "not yet"} / token: {connection.tokenHint ?? "hidden"}
                  </p>
                </div>
                <button
                  className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={state !== "active" || revokingId === connection.id}
                  onClick={() => void revoke(connection.id)}
                  type="button"
                >
                  {revokingId === connection.id ? "Revoking" : "Revoke"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
