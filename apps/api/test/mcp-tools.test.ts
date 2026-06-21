import { describe, expect, it } from "vitest";
import { mcpToolDefinitions } from "../src/modules/mcp/mcp-tools";

describe("MCP tool registry", () => {
  it("keeps external tools scoped, described, and schema-backed", () => {
    for (const tool of mcpToolDefinitions) {
      expect(tool.name).toMatch(/^(creator|admin)_/);
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tool.description.length).toBeGreaterThan(12);
      expect(tool.requiredScopes.length).toBeGreaterThan(0);
      expect(tool.roleTypes.length).toBeGreaterThan(0);
      expect(["read", "draft", "request"]).toContain(tool.riskLevel);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
    }
  });

  it("does not register live-action production mutation tools", () => {
    const forbiddenTerms = new Set([
      "publish",
      "send",
      "refund",
      "ban",
      "delete",
      "settle",
      "withdraw",
      "kyc",
      "override",
      "solana_state",
      "shell",
      "sql",
      "browser",
      "file"
    ]);

    for (const tool of mcpToolDefinitions) {
      expect(tool.name.split("_").some((term) => forbiddenTerms.has(term))).toBe(false);
    }
  });
});
