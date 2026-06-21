import type { AdminRepository } from "../admin/types.js";
import type { ContentRepository } from "../content/types.js";
import type { ProfileRepository } from "../profile/types.js";
import type {
  McpConnection,
  McpRoleType,
  McpScope,
  McpToolDefinition
} from "./types.js";

export const creatorMcpScopes: McpScope[] = [
  "creator.profile.read",
  "creator.profile.draft",
  "creator.metrics.read",
  "creator.drafts.read",
  "creator.drafts.write",
  "creator.events.read",
  "creator.events.draft",
  "creator.media.read",
  "creator.media.label",
  "creator.publish.request"
];

export const adminMcpScopes: McpScope[] = [
  "admin.health.read",
  "admin.support.read",
  "admin.support.draft",
  "admin.moderation.read",
  "admin.moderation.draft",
  "admin.payments.read",
  "admin.tasks.create"
];

const allMcpScopes = new Set<McpScope>([...creatorMcpScopes, ...adminMcpScopes]);
const creatorScopeSet = new Set<McpScope>(creatorMcpScopes);
const adminScopeSet = new Set<McpScope>(adminMcpScopes);

export const mcpToolDefinitions: McpToolDefinition[] = [
  {
    name: "creator_get_profile",
    version: "1.0.0",
    description: "Read the connected creator profile and onboarding readiness.",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({ profile: { type: "object" }, onboarding: { type: "object" } }),
    requiredScopes: ["creator.profile.read"],
    roleTypes: ["creator"],
    riskLevel: "read"
  },
  {
    name: "creator_get_metrics_summary",
    version: "1.0.0",
    description: "Read the connected creator monetisation dashboard summary.",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({ dashboard: { type: "object" } }),
    requiredScopes: ["creator.metrics.read"],
    roleTypes: ["creator"],
    riskLevel: "read"
  },
  {
    name: "creator_create_content_draft",
    version: "1.0.0",
    description: "Create a private creator content draft. This does not publish content.",
    inputSchema: objectSchema({
      mediaType: { type: "string", enum: ["bit", "clip", "image", "vod", "live_replay"] },
      caption: { type: "string", maxLength: 2_000 },
      visibility: { type: "string", enum: ["public", "followers", "subscribers", "private"] },
      nsfwLabel: { type: "string", enum: ["none", "adult", "explicit", "sensitive"] }
    }),
    outputSchema: objectSchema({ content: { type: "object" } }),
    requiredScopes: ["creator.drafts.write"],
    roleTypes: ["creator"],
    riskLevel: "draft"
  },
  {
    name: "admin_get_platform_health_summary",
    version: "1.0.0",
    description: "Read the admin operations health summary.",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({ summary: { type: "object" } }),
    requiredScopes: ["admin.health.read"],
    roleTypes: ["admin"],
    riskLevel: "read"
  },
  {
    name: "admin_list_support_cases",
    version: "1.0.0",
    description: "Read open support cases for staff triage.",
    inputSchema: objectSchema({ cursor: { type: "string" } }),
    outputSchema: objectSchema({ items: { type: "array" }, nextCursor: { type: ["string", "null"] } }),
    requiredScopes: ["admin.support.read"],
    roleTypes: ["admin"],
    riskLevel: "read"
  },
  {
    name: "admin_list_payment_intents",
    version: "1.0.0",
    description: "Read payment intent summaries for staff reconciliation.",
    inputSchema: objectSchema({ cursor: { type: "string" }, query: { type: "string" } }),
    outputSchema: objectSchema({ items: { type: "array" }, nextCursor: { type: ["string", "null"] } }),
    requiredScopes: ["admin.payments.read"],
    roleTypes: ["admin"],
    riskLevel: "read"
  }
];

export const mcpToolNames = new Set(mcpToolDefinitions.map((tool) => tool.name));

export function isMcpScope(value: unknown): value is McpScope {
  return typeof value === "string" && allMcpScopes.has(value as McpScope);
}

export function scopesAllowedForRole(roleType: McpRoleType, scopes: McpScope[]): boolean {
  const allowedSet = roleType === "creator" ? creatorScopeSet : adminScopeSet;
  return scopes.length > 0 && scopes.every((scope) => allowedSet.has(scope));
}

export function toolsForConnection(connection: Pick<McpConnection, "roleType" | "scopes">): McpToolDefinition[] {
  const grantedScopes = new Set(connection.scopes);
  return mcpToolDefinitions.filter(
    (tool) =>
      tool.roleTypes.includes(connection.roleType) &&
      tool.requiredScopes.every((scope) => grantedScopes.has(scope))
  );
}

export function findMcpTool(name: string): McpToolDefinition | null {
  return mcpToolDefinitions.find((tool) => tool.name === name) ?? null;
}

export async function runMcpTool(input: {
  connection: McpConnection & { supabaseUserId: string };
  tool: McpToolDefinition;
  params: unknown;
  profileRepository: ProfileRepository;
  contentRepository: ContentRepository;
  adminRepository: AdminRepository;
}): Promise<Record<string, unknown>> {
  switch (input.tool.name) {
    case "creator_get_profile": {
      const [dashboard, onboarding] = await Promise.all([
        input.profileRepository.getMyCreatorDashboard(input.connection.supabaseUserId),
        input.profileRepository.getMyCreatorOnboarding(input.connection.supabaseUserId)
      ]);
      return { dashboard, onboarding };
    }
    case "creator_get_metrics_summary": {
      const dashboard = await input.profileRepository.getMyCreatorDashboard(
        input.connection.supabaseUserId
      );
      return { dashboard };
    }
    case "creator_create_content_draft": {
      const body = contentDraftInput(input.params);
      const content = await input.contentRepository.createDraft({
        supabaseUserId: input.connection.supabaseUserId,
        mediaType: body.mediaType,
        caption: body.caption,
        visibility: body.visibility,
        nsfwLabel: body.nsfwLabel
      });
      return { content };
    }
    case "admin_get_platform_health_summary": {
      return { summary: await input.adminRepository.getOpsSummary() };
    }
    case "admin_list_support_cases": {
      const params = optionalCursorInput(input.params);
      return { page: await input.adminRepository.listSupportCases(params) };
    }
    case "admin_list_payment_intents": {
      const params = optionalCursorAndQueryInput(input.params);
      return { page: await input.adminRepository.listPaymentIntents(params) };
    }
    default:
      throw new Error("Unsupported MCP tool");
  }
}

export function redactedToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/token|authorization|cookie|wallet|signature|email|phone|address/i.test(key)) {
      result[key] = "[redacted]";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (value === null) {
      result[key] = null;
    } else {
      result[key] = "[object]";
    }
  }

  return result;
}

export function summarizeValue(value: unknown): string {
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value.slice(0, 160) : "empty";
  }

  return Object.keys(value as Record<string, unknown>).sort().join(", ").slice(0, 160) || "empty";
}

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties
  };
}

function contentDraftInput(value: unknown): {
  mediaType: "bit" | "clip" | "image" | "vod" | "live_replay";
  caption: string | null;
  visibility: "public" | "followers" | "subscribers" | "private";
  nsfwLabel: "none" | "adult" | "explicit" | "sensitive";
} {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const mediaType = stringEnum(body.mediaType, ["bit", "clip", "image", "vod", "live_replay"]);
  const visibility = stringEnum(body.visibility, ["public", "followers", "subscribers", "private"]);
  const nsfwLabel = stringEnum(body.nsfwLabel, ["none", "adult", "explicit", "sensitive"]);
  const caption = typeof body.caption === "string" ? body.caption.slice(0, 2_000) : null;

  if (!mediaType || !visibility || !nsfwLabel) {
    throw new McpToolValidationError("mediaType, visibility, and nsfwLabel are required");
  }

  return { mediaType, visibility, nsfwLabel, caption };
}

function optionalCursorInput(value: unknown): { cursor?: string } {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return typeof body.cursor === "string" ? { cursor: body.cursor } : {};
}

function optionalCursorAndQueryInput(value: unknown): { cursor?: string; query?: string } {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}),
    ...(typeof body.query === "string" ? { query: body.query } : {})
  };
}

function stringEnum<const Value extends string>(value: unknown, values: readonly Value[]): Value | null {
  return typeof value === "string" && values.includes(value as Value) ? (value as Value) : null;
}

export class McpToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolValidationError";
  }
}
