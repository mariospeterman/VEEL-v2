import type { AiCapabilities, AiSessionScope } from "./types.js";

const sessionScopes: AiSessionScope[] = [
  "user_self_service",
  "creator_helper",
  "admin_ops"
];

/**
 * The legacy in-app assistant had only canned placeholder outputs and is
 * intentionally unavailable. Keep a capability projection for compatibility,
 * but never advertise an executable tool through this route family. Real
 * connected-assistant capabilities live behind the scoped MCP boundary.
 */
export function buildCapabilities(adminAllowed: boolean): AiCapabilities {
  return {
    items: sessionScopes
      .filter((scope) => scope !== "admin_ops" || adminAllowed)
      .map((scope) => ({
        scope,
        allowedTools: [],
        canStartSession: false,
        confirmationRequiredTools: []
      }))
  };
}
