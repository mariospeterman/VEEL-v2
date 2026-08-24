import { describe, expect, it } from "vitest";
import { mcpToolDefinitions, redactedToolInput } from "../src/modules/mcp/mcp-tools";

describe("MCP tool registry", () => {
  it("keeps external tools scoped, described, and schema-backed", () => {
    for (const tool of mcpToolDefinitions) {
      expect(tool.name).toMatch(/^(creator|admin)_/);
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tool.description.length).toBeGreaterThan(12);
      expect(tool.requiredScopes.length).toBeGreaterThan(0);
      expect(tool.roleTypes.length).toBeGreaterThan(0);
      expect(["read", "draft", "request"]).toContain(tool.riskLevel);
      expect(tool.inputSchema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false
      });
      expect(tool.outputSchema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false
      });
      expect(tool.annotations).toMatchObject({
        title: expect.any(String),
        destructiveHint: false,
        openWorldHint: false
      });
      expect(tool.annotations.readOnlyHint).toBe(tool.riskLevel === "read");
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

  it("limits creator writes to an idempotent private draft handoff", () => {
    const creatorWrites = mcpToolDefinitions.filter((tool) =>
      tool.roleTypes.includes("creator") && !tool.annotations.readOnlyHint
    );

    expect(creatorWrites.map((tool) => tool.name)).toEqual(["creator_create_private_draft"]);
    expect(creatorWrites[0]?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    expect(creatorWrites[0]?.inputSchema).not.toHaveProperty("properties.visibility");
    expect(creatorWrites[0]?.inputSchema).not.toHaveProperty("properties.nsfwLabel");
  });

  it("redacts creator-authored text from durable tool-call audit input", () => {
    expect(redactedToolInput({
      mediaType: "text",
      caption: "private caption",
      bodyText: "private body",
      poll: { question: "private question" }
    })).toEqual({
      mediaType: "text",
      caption: "[redacted]",
      bodyText: "[redacted]",
      poll: "[redacted]"
    });
  });
});
