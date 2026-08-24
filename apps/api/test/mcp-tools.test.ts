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

  it("limits creator writes to private draft and one-time media handoff", () => {
    const creatorWrites = mcpToolDefinitions.filter((tool) =>
      tool.roleTypes.includes("creator") && !tool.annotations.readOnlyHint
    );

    expect(creatorWrites.map((tool) => tool.name)).toEqual([
      "creator_create_private_draft",
      "creator_prepare_private_media_upload"
    ]);
    for (const tool of creatorWrites) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
      expect(tool.inputSchema).not.toHaveProperty("properties.visibility");
      expect(tool.inputSchema).not.toHaveProperty("properties.nsfwLabel");
    }
    const mediaTool = creatorWrites[1]!;
    expect(mediaTool.requiredScopes).toEqual(["creator.drafts.write", "creator.media.label"]);
    expect(mediaTool.inputSchema).not.toHaveProperty("properties.url");
    expect(mediaTool.inputSchema).not.toHaveProperty("properties.base64");
    expect(mediaTool.inputSchema).toHaveProperty(
      "properties.provenance.properties.originClassification.enum"
    );
    const originEnum = (mediaTool.inputSchema as {
      properties: { provenance: { properties: { originClassification: { enum: string[] } } } };
    }).properties.provenance.properties.originClassification.enum;
    expect(originEnum).not.toContain("human_created");
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
