"use client";

import { useState } from "react";
import { revokeMcpConnection } from "@/api-mutations";
import type { ApiResult, McpConnectionPage } from "@/api-client";
import { mapApiFailure, safeMutationMessage } from "@/api-errors";
import {
  formatMcpLastUsed,
  mcpAuthLabel,
  mcpConnectionStateLabel,
  mcpRoleLabel,
  mcpScopeLabel
} from "@/mcp-display";

export function McpConnectionsPanel({ connections }: { connections: ApiResult<McpConnectionPage> }) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  if (!connections.ok) {
    const mapped = mapApiFailure(connections, "Connected AI / MCP");
    return (
      <div className="rounded border border-(--line) bg-(--background) p-3 text-sm">
        <p className="font-medium">Connected assistants</p>
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
      setMessage(safeMutationMessage(error, "Connected assistant revocation"));
    } finally {
      setRevokingId(null);
    }
  }

  const items = connections.data.items;

  return (
    <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div>
        <p className="font-medium">Connected assistants</p>
        <p className="mt-1 text-(--muted)">
          {message ?? `${items.length} connection${items.length === 1 ? "" : "s"}. Assistants bring their own AI; WeVid stores no model keys.`}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-(--muted)">
          No assistants are connected to your WeVid account.
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
                    {mcpAuthLabel(connection.authMode)} · {mcpRoleLabel(connection.roleType)} · {mcpConnectionStateLabel(state)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {connection.scopes.map((scope) => (
                      <span className="rounded border border-(--line) px-2 py-1 text-xs text-(--muted)" key={scope}>
                        {mcpScopeLabel(scope)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-(--muted)">
                    Last used: {formatMcpLastUsed(connection.lastUsedAt)} · Access secret hidden
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
