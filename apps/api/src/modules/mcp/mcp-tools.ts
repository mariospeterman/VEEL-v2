import { createHash, randomBytes } from "node:crypto";
import type { AdminRepository } from "../admin/types.js";
import { AnalyticsQueryValidationError } from "../analytics/analytics-errors.js";
import { AnalyticsQueryService } from "../analytics/analytics-service.js";
import type { AnalyticsDimensions, AnalyticsQueryRequest, AnalyticsRepository } from "../analytics/types.js";
import {
  dailyQuotaWindowStart,
  resolveContentCreationAbusePolicy
} from "../content/content-route-shared.js";
import { ContentDraftPollCloseError } from "../content/content-errors.js";
import type {
  AiOriginClassification,
  ContentRepository,
  McpMediaMimeType,
  McpMediaProvenanceClaim,
  MediaSourceKind
} from "../content/types.js";
import { hashIdempotencyPayload } from "../../shared/idempotency.js";
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
    outputSchema: objectSchema(
      { profile: { type: ["object", "null"] }, readiness: { type: ["object", "null"] }, onboarding: { type: ["object", "null"] } },
      ["profile", "readiness", "onboarding"]
    ),
    requiredScopes: ["creator.profile.read"],
    roleTypes: ["creator"],
    riskLevel: "read",
    annotations: readAnnotations("My WeVid profile")
  },
  {
    name: "creator_query_analytics",
    version: "1.0.0",
    description: "Query the connected creator's authorized Analytics Core metrics without recomputing or inferring values.",
    inputSchema: objectSchema({
      metricKeys: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string" } },
      startDate: { type: "string", format: "date" },
      endDate: { type: "string", format: "date" },
      granularity: { type: "string", enum: ["day", "total"] },
      dimensions: {
        type: "object",
        additionalProperties: false,
        properties: {
          contentId: { type: "string", format: "uuid" },
          mediaType: { type: "string" },
          currency: { type: "string", enum: ["SOL", "USDC"] },
          productType: { type: "string" },
          cohortStartDate: { type: "string", format: "date" }
        }
      }
    }, ["metricKeys", "startDate", "endDate", "granularity"]),
    outputSchema: objectSchema({ analytics: { type: "object" } }, ["analytics"]),
    requiredScopes: ["creator.metrics.read"],
    roleTypes: ["creator"],
    riskLevel: "read",
    annotations: readAnnotations("My WeVid analytics")
  },
  {
    name: "creator_list_private_drafts",
    version: "1.0.0",
    description: "List bounded safe metadata for the connected creator's private drafts.",
    inputSchema: objectSchema({ cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }),
    outputSchema: objectSchema({ items: { type: "array" }, nextCursor: { type: ["string", "null"] } }, ["items", "nextCursor"]),
    requiredScopes: ["creator.drafts.read"],
    roleTypes: ["creator"],
    riskLevel: "read",
    annotations: readAnnotations("My private WeVid drafts")
  },
  {
    name: "creator_get_draft_readiness",
    version: "1.0.0",
    description: "Inspect backend-derived readiness for one owned private draft without publishing it.",
    inputSchema: objectSchema({ contentId: { type: "string", format: "uuid" } }, ["contentId"]),
    outputSchema: objectSchema({ readiness: { type: "object" } }, ["readiness"]),
    requiredScopes: ["creator.drafts.read"],
    roleTypes: ["creator"],
    riskLevel: "read",
    annotations: readAnnotations("Private draft readiness")
  },
  {
    name: "creator_create_private_draft",
    version: "1.0.0",
    description: "Prepare an idempotent SFW private creator draft for review in WeVid. This cannot publish.",
    inputSchema: objectSchema({
      mediaType: { type: "string", enum: ["bit", "clip", "image", "vod", "live_replay", "text", "poll"] },
      caption: { type: "string", maxLength: 2_000 },
      bodyText: { type: "string", minLength: 1, maxLength: 10_000 },
      poll: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1, maxLength: 500 },
          options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 200 } },
          closesAt: { type: ["string", "null"], format: "date-time" }
        },
        required: ["question", "options"]
      }
    }, ["mediaType"]),
    outputSchema: objectSchema({ draft: { type: "object" }, nextAction: { type: "string", const: "review_in_wevid" } }, ["draft", "nextAction"]),
    requiredScopes: ["creator.drafts.write"],
    roleTypes: ["creator"],
    riskLevel: "draft",
    annotations: {
      title: "Prepare a private WeVid draft",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "creator_prepare_private_media_upload",
    version: "1.0.0",
    description: "Prepare a short-lived one-time media handoff for one owned SFW private draft. This cannot publish.",
    inputSchema: objectSchema({
      requestId: { type: "string", format: "uuid" },
      contentId: { type: "string", format: "uuid" },
      mimeType: {
        type: "string",
        enum: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]
      },
      provenance: {
        type: "object",
        additionalProperties: false,
        properties: {
          originClassification: {
            type: "string",
            enum: ["ai_assisted", "ai_generated", "materially_ai_manipulated"]
          },
          sourceKind: { type: "string", enum: ["generated", "edited", "composited", "unknown"] },
          sourceLineageReference: {
            type: ["string", "null"], maxLength: 500, pattern: "^(https://|urn:)"
          },
          workflowProviderReference: {
            type: ["string", "null"], maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$"
          },
          c2paReference: {
            type: ["string", "null"], maxLength: 500, pattern: "^(https://|urn:)"
          }
        },
        required: ["originClassification", "sourceKind"]
      }
    }, ["requestId", "contentId", "mimeType", "provenance"]),
    outputSchema: objectSchema({ capability: { type: "object" }, nextAction: { type: "string" } }, ["capability", "nextAction"]),
    requiredScopes: ["creator.drafts.write", "creator.media.label"],
    roleTypes: ["creator"],
    riskLevel: "draft",
    annotations: {
      title: "Prepare private media upload",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "creator_get_private_media_readiness",
    version: "1.0.0",
    description: "Read minimized provider, quarantine, and provenance state for one owned private draft without media URLs or provider identifiers.",
    inputSchema: objectSchema({ contentId: { type: "string", format: "uuid" } }, ["contentId"]),
    outputSchema: objectSchema({ readiness: { type: "object" } }, ["readiness"]),
    requiredScopes: ["creator.drafts.read", "creator.media.read"],
    roleTypes: ["creator"],
    riskLevel: "read",
    annotations: readAnnotations("Private media readiness")
  },
  {
    name: "admin_get_platform_health_summary",
    version: "1.0.0",
    description: "Read the admin operations health summary.",
    inputSchema: objectSchema({}),
    outputSchema: objectSchema({ summary: { type: "object" } }, ["summary"]),
    requiredScopes: ["admin.health.read"],
    roleTypes: ["admin"],
    riskLevel: "read",
    annotations: readAnnotations("WeVid platform health")
  },
  {
    name: "admin_list_support_cases",
    version: "1.0.0",
    description: "Read open support cases for staff triage.",
    inputSchema: objectSchema({ cursor: { type: "string" } }),
    outputSchema: objectSchema({ items: { type: "array" }, nextCursor: { type: ["string", "null"] } }, ["items", "nextCursor"]),
    requiredScopes: ["admin.support.read"],
    roleTypes: ["admin"],
    riskLevel: "read",
    annotations: readAnnotations("WeVid support cases")
  },
  {
    name: "admin_list_payment_intents",
    version: "1.0.0",
    description: "Read payment intent summaries for staff reconciliation.",
    inputSchema: objectSchema({ cursor: { type: "string" }, query: { type: "string" } }),
    outputSchema: objectSchema({ items: { type: "array" }, nextCursor: { type: ["string", "null"] } }, ["items", "nextCursor"]),
    requiredScopes: ["admin.payments.read"],
    roleTypes: ["admin"],
    riskLevel: "read",
    annotations: readAnnotations("WeVid payment intents")
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
  analyticsRepository: AnalyticsRepository;
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
      return {
        profile: dashboard?.creator ? minimizedProfile(dashboard.creator) : null,
        readiness: dashboard?.readiness ? minimizedCreatorReadiness(dashboard.readiness) : null,
        onboarding: onboarding ? minimizedOnboarding(onboarding) : null
      };
    }
    case "creator_query_analytics": {
      const request = creatorAnalyticsInput(input.params);
      try {
        const analytics = await new AnalyticsQueryService(input.analyticsRepository).query(
          input.connection.supabaseUserId,
          request
        );
        if (!analytics) throw new McpToolValidationError("Creator analytics access is unavailable");
        return { analytics: { ...analytics, scope: { type: "creator" } } };
      } catch (error) {
        if (error instanceof AnalyticsQueryValidationError) {
          throw new McpToolValidationError(error.message);
        }
        throw error;
      }
    }
    case "creator_list_private_drafts": {
      if (!input.contentRepository.listOwnedContent) {
        throw new McpToolValidationError("Private draft metadata is unavailable");
      }
      const params = privateDraftListInput(input.params);
      const page = await input.contentRepository.listOwnedContent({
        supabaseUserId: input.connection.supabaseUserId,
        privateDraftsOnly: true,
        ...params
      });
      return {
        items: page.items
          .filter((item) => item.visibility === "private" && item.publicationState !== "published")
          .map(({ id, mediaType, publicationState, reviewState, createdAt, updatedAt }) => ({
            contentId: id,
            mediaType,
            publicationState,
            reviewState,
            createdAt,
            updatedAt
          })),
        nextCursor: page.nextCursor
      };
    }
    case "creator_get_draft_readiness": {
      if (!input.contentRepository.findOwnedPrivateDraftReadiness) {
        throw new McpToolValidationError("Private draft readiness is unavailable");
      }
      const contentId = requiredUuid(input.params, "contentId");
      const readiness = await input.contentRepository.findOwnedPrivateDraftReadiness({
        supabaseUserId: input.connection.supabaseUserId,
        contentId
      });
      if (!readiness) throw new McpToolValidationError("Owned private draft not found");
      return { readiness };
    }
    case "creator_create_private_draft": {
      const body = privateDraftInput(input.params);
      const abusePolicy = await resolveContentCreationAbusePolicy(input.contentRepository);
      const requestHash = hashIdempotencyPayload(body);
      let content;
      try {
        content = await input.contentRepository.createDraft({
          supabaseUserId: input.connection.supabaseUserId,
          idempotencyKey: `mcp-private-draft:${input.connection.id}:${requestHash}`,
          requestHash,
          mediaType: body.mediaType,
          caption: body.caption,
          bodyText: body.bodyText,
          poll: body.poll,
          visibility: "private",
          nsfwLabel: "none",
          representationMode: "not_declared",
          contentSafetyPolicyAccepted: false,
          quotaWindowStart: dailyQuotaWindowStart(new Date(), abusePolicy.rollingWindowHours),
          dailyDraftQuota: abusePolicy.dailyContentDraftQuota,
          origin: {
            kind: "mcp",
            connectionId: input.connection.id,
            toolName: "creator_create_private_draft",
            toolVersion: input.tool.version,
            requestHash
          }
        });
      } catch (error) {
        if (error instanceof ContentDraftPollCloseError) {
          throw new McpToolValidationError("Poll closesAt must be a future ISO date-time or null");
        }
        throw error;
      }
      return {
        draft: { contentId: content.id, mediaType: content.mediaType, caption: content.caption ?? null, visibility: "private" },
        nextAction: "review_in_wevid"
      };
    }
    case "creator_prepare_private_media_upload": {
      if (!input.contentRepository.issueMcpMediaUploadCapability) {
        throw new McpToolValidationError("Private media upload preparation is unavailable");
      }
      const body = privateMediaCapabilityInput(input.params);
      const capabilityToken = randomBytes(32).toString("base64url");
      const capability = await input.contentRepository.issueMcpMediaUploadCapability({
        connectionId: input.connection.id,
        supabaseUserId: input.connection.supabaseUserId,
        contentId: body.contentId,
        requestHash: hashIdempotencyPayload(body),
        tokenHash: createHash("sha256").update(capabilityToken).digest("hex"),
        mediaKind: body.mimeType.startsWith("image/") ? "image" : "video",
        mimeType: body.mimeType,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ...body.provenance
      });
      if (!capability) {
        throw new McpToolValidationError("Owned compatible SFW private draft was not found or is full");
      }
      return {
        capability: {
          capabilityId: capability.id,
          contentId: capability.contentId,
          mediaAssetId: capability.mediaAssetId,
          kind: capability.mediaKind,
          mimeType: capability.mimeType,
          expiresAt: capability.expiresAt,
          status: capability.issued ? "issued" : "already_issued",
          capabilityToken: capability.issued ? capabilityToken : null,
          redeemPath: `/v1/mcp/media/uploads/${capability.id}`
        },
        nextAction: capability.issued ? "upload_media" : "use_original_capability_or_request_a_new_id"
      };
    }
    case "creator_get_private_media_readiness": {
      if (!input.contentRepository.findOwnedPrivateMediaReadiness) {
        throw new McpToolValidationError("Private media readiness is unavailable");
      }
      const contentId = requiredUuid(input.params, "contentId");
      const readiness = await input.contentRepository.findOwnedPrivateMediaReadiness({
        supabaseUserId: input.connection.supabaseUserId,
        contentId
      });
      if (!readiness) throw new McpToolValidationError("Owned private draft not found");
      return { readiness };
    }
    case "admin_get_platform_health_summary": {
      return { summary: await input.adminRepository.getOpsSummary() };
    }
    case "admin_list_support_cases": {
      const params = optionalCursorInput(input.params);
      const page = await input.adminRepository.listSupportCases(params);
      return { items: page.items, nextCursor: page.nextCursor };
    }
    case "admin_list_payment_intents": {
      const params = optionalCursorAndQueryInput(input.params);
      const page = await input.adminRepository.listPaymentIntents(params);
      return { items: page.items, nextCursor: page.nextCursor };
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
    if (/token|authorization|cookie|wallet|signature|email|phone|address|caption|bodyText|question|options|poll|prompt|message/i.test(key)) {
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

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

function readAnnotations(title: string): McpToolDefinition["annotations"] {
  return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

function privateDraftInput(value: unknown): {
  mediaType: "bit" | "clip" | "image" | "vod" | "live_replay" | "text" | "poll";
  caption: string | null;
  bodyText?: string;
  poll?: { question: string; options: string[]; closesAt?: string | null };
} {
  const body = objectValue(value);
  assertAllowedKeys(body, ["mediaType", "caption", "bodyText", "poll"]);
  const mediaType = stringEnum(body.mediaType, ["bit", "clip", "image", "vod", "live_replay", "text", "poll"]);
  if (body.caption !== undefined && (typeof body.caption !== "string" || body.caption.length > 2_000)) {
    throw new McpToolValidationError("Draft caption must contain at most 2000 characters");
  }
  const trimmedCaption = typeof body.caption === "string" ? body.caption.trim() : "";
  const caption = trimmedCaption.length > 0 ? trimmedCaption : null;

  if (!mediaType) throw new McpToolValidationError("A supported mediaType is required");
  if (mediaType === "text") {
    if (body.poll !== undefined) throw new McpToolValidationError("Text drafts cannot include poll input");
    if (typeof body.bodyText !== "string" || body.bodyText.trim().length < 1 || body.bodyText.length > 10_000) {
      throw new McpToolValidationError("Text drafts require bodyText between one and 10000 characters");
    }
    return { mediaType, caption, bodyText: body.bodyText.trim() };
  }
  if (mediaType === "poll") {
    if (body.bodyText !== undefined) throw new McpToolValidationError("Poll drafts cannot include bodyText");
    return { mediaType, caption, poll: parsePoll(body.poll) };
  }
  if (body.bodyText !== undefined || body.poll !== undefined) {
    throw new McpToolValidationError("Media drafts cannot include text or poll composition input");
  }
  return { mediaType, caption };
}

function privateMediaCapabilityInput(value: unknown): {
  requestId: string;
  contentId: string;
  mimeType: McpMediaMimeType;
  provenance: McpMediaProvenanceClaim;
} {
  const body = objectValue(value);
  assertAllowedKeys(body, ["requestId", "contentId", "mimeType", "provenance"]);
  const capabilityKeys = ["requestId", "contentId", "mimeType", "provenance"];
  const requestId = requiredUuid(body, "requestId", capabilityKeys);
  const contentId = requiredUuid(body, "contentId", capabilityKeys);
  const mimeTypes = new Set<McpMediaMimeType>([
    "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"
  ]);
  if (typeof body.mimeType !== "string" || !mimeTypes.has(body.mimeType as McpMediaMimeType)) {
    throw new McpToolValidationError("A supported image or video mimeType is required");
  }

  const provenanceBody = objectValue(body.provenance);
  assertAllowedKeys(provenanceBody, [
    "originClassification",
    "sourceKind",
    "sourceLineageReference",
    "workflowProviderReference",
    "c2paReference"
  ]);
  const origins = new Set<AiOriginClassification>([
    "ai_assisted", "ai_generated", "materially_ai_manipulated"
  ]);
  const sourceKinds = new Set<MediaSourceKind>(["generated", "edited", "composited", "unknown"]);
  if (
    typeof provenanceBody.originClassification !== "string" ||
    !origins.has(provenanceBody.originClassification as AiOriginClassification)
  ) {
    throw new McpToolValidationError("Assistant media must declare a supported AI origin classification");
  }
  if (
    typeof provenanceBody.sourceKind !== "string" ||
    !sourceKinds.has(provenanceBody.sourceKind as MediaSourceKind)
  ) {
    throw new McpToolValidationError("A supported provenance sourceKind is required");
  }
  const sourceLineageReference = optionalStructuredProvenanceReference(
    provenanceBody.sourceLineageReference,
    "sourceLineageReference",
    500
  );
  const workflowProviderReference = optionalOpaqueProvenanceReference(
    provenanceBody.workflowProviderReference,
    "workflowProviderReference",
    120
  );
  const c2paReference = optionalStructuredProvenanceReference(
    provenanceBody.c2paReference,
    "c2paReference",
    500
  );
  return {
    requestId,
    contentId,
    mimeType: body.mimeType as McpMediaMimeType,
    provenance: {
      originClassification: provenanceBody.originClassification as AiOriginClassification,
      sourceKind: provenanceBody.sourceKind as MediaSourceKind,
      sourceLineageReference,
      workflowProviderReference,
      c2paReference
    }
  };
}

function optionalProvenanceReference(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new McpToolValidationError(`${field} must be a bounded string or null`);
  }
  const reference = value.trim();
  const decoded = safeDecodeReference(reference);
  if (
    /(?:prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secret|authorization|bearer|cookie|session[-_ ]?id)/i.test(decoded) ||
    /-----begin [^-]+ private key-----/i.test(decoded)
  ) {
    throw new McpToolValidationError("Provenance references cannot contain prompts or credentials");
  }
  return reference;
}

function optionalStructuredProvenanceReference(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  const reference = optionalProvenanceReference(value, field, maxLength);
  if (!reference) return null;
  if (/^urn:[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._~:/-]*$/i.test(reference)) {
    return reference;
  }
  try {
    const url = new URL(reference);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    ) {
      return reference;
    }
  } catch {
    // The normalized validation error below is the public contract.
  }
  throw new McpToolValidationError(`${field} must be a credential-free HTTPS URL or URN`);
}

function optionalOpaqueProvenanceReference(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  const reference = optionalProvenanceReference(value, field, maxLength);
  if (!reference) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(reference)) {
    throw new McpToolValidationError(`${field} must be an opaque provider identifier`);
  }
  return reference;
}

function safeDecodeReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePoll(value: unknown): { question: string; options: string[]; closesAt?: string | null } {
  const poll = objectValue(value);
  assertAllowedKeys(poll, ["question", "options", "closesAt"]);
  if (typeof poll.question !== "string" || poll.question.trim().length < 1 || poll.question.length > 500) {
    throw new McpToolValidationError("Poll drafts require a question between one and 500 characters");
  }
  if (!Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 4) {
    throw new McpToolValidationError("Poll drafts require between two and four options");
  }
  const options = poll.options.map((option) => {
    if (typeof option !== "string" || option.trim().length < 1 || option.length > 200) {
      throw new McpToolValidationError("Poll options must contain between one and 200 characters");
    }
    return option.trim();
  });
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    throw new McpToolValidationError("Poll options must be unique");
  }
  if (
    poll.closesAt !== undefined &&
    poll.closesAt !== null &&
    !isIsoDateTime(poll.closesAt)
  ) {
    throw new McpToolValidationError("Poll closesAt must be a future ISO date-time or null");
  }
  return {
    question: poll.question.trim(),
    options,
    ...(poll.closesAt !== undefined ? { closesAt: poll.closesAt as string | null } : {})
  };
}

function creatorAnalyticsInput(value: unknown): AnalyticsQueryRequest {
  const body = objectValue(value);
  assertAllowedKeys(body, ["metricKeys", "startDate", "endDate", "granularity", "dimensions"]);
  if (!Array.isArray(body.metricKeys) || body.metricKeys.length < 1 || body.metricKeys.length > 10) {
    throw new McpToolValidationError("Choose between one and ten analytics metrics");
  }
  const metricKeys = body.metricKeys.map((metricKey) => {
    if (typeof metricKey !== "string" || metricKey.length < 1 || metricKey.length > 120) {
      throw new McpToolValidationError("Analytics metric keys must be bounded strings");
    }
    return metricKey;
  });
  if (new Set(metricKeys).size !== metricKeys.length) {
    throw new McpToolValidationError("Analytics metric keys must be unique");
  }
  if (typeof body.startDate !== "string" || typeof body.endDate !== "string") {
    throw new McpToolValidationError("Analytics requires ISO startDate and endDate values");
  }
  const granularity = stringEnum(body.granularity, ["day", "total"]);
  if (!granularity) throw new McpToolValidationError("Analytics granularity must be day or total");
  return {
    scope: { type: "creator" },
    metricKeys,
    window: { startDate: body.startDate, endDate: body.endDate },
    granularity,
    timezone: "UTC",
    ...(body.dimensions === undefined ? {} : { dimensions: creatorAnalyticsDimensions(body.dimensions) })
  };
}

function creatorAnalyticsDimensions(value: unknown): AnalyticsDimensions {
  const body = objectValue(value);
  assertAllowedKeys(body, ["contentId", "mediaType", "currency", "productType", "cohortStartDate"]);
  const dimensions: AnalyticsDimensions = {};
  for (const key of ["contentId", "mediaType", "productType", "cohortStartDate"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string" || body[key].length < 1 || body[key].length > 120) {
        throw new McpToolValidationError(`${key} must be a bounded string`);
      }
      dimensions[key] = body[key];
    }
  }
  if (body.currency !== undefined) {
    const currency = stringEnum(body.currency, ["SOL", "USDC"]);
    if (!currency) throw new McpToolValidationError("Analytics currency must be SOL or USDC");
    dimensions.currency = currency;
  }
  return dimensions;
}

function privateDraftListInput(value: unknown): { cursor?: string; limit: number } {
  const body = objectValue(value);
  assertAllowedKeys(body, ["cursor", "limit"]);
  if (body.cursor !== undefined && (typeof body.cursor !== "string" || !isIsoDateTime(body.cursor))) {
    throw new McpToolValidationError("Draft cursor must be an ISO date-time");
  }
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 20)) {
    throw new McpToolValidationError("Draft limit must be between one and 20");
  }
  return {
    ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}),
    limit: typeof body.limit === "number" ? body.limit : 10
  };
}

function requiredUuid(value: unknown, key: string, allowedKeys: string[] = [key]): string {
  const body = objectValue(value);
  assertAllowedKeys(body, allowedKeys);
  const candidate = body[key];
  if (typeof candidate !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
    throw new McpToolValidationError(`${key} must be a UUID`);
  }
  return candidate;
}

type CreatorDashboard = NonNullable<Awaited<ReturnType<ProfileRepository["getMyCreatorDashboard"]>>>;
type CreatorOnboarding = NonNullable<Awaited<ReturnType<ProfileRepository["getMyCreatorOnboarding"]>>>;

function minimizedProfile(value: CreatorDashboard["creator"]): Record<string, unknown> {
  return {
    handle: value.handle,
    displayName: value.displayName,
    avatarUrl: value.avatarUrl ?? null,
    badges: value.badges
  };
}

function minimizedCreatorReadiness(value: CreatorDashboard["readiness"]): Record<string, unknown> {
  return {
    state: value.state,
    readinessScore: value.readinessScore,
    canMonetize: value.canMonetize,
    nextAction: value.nextAction ?? null,
    blockedReasons: value.blockedReasons
  };
}

function minimizedOnboarding(value: CreatorOnboarding): Record<string, unknown> {
  return {
    state: value.state,
    canStartEarning: value.canStartEarning,
    readinessScore: value.readinessScore,
    nextAction: value.nextAction ?? null,
    steps: value.steps.map(({ key, label, state, required, actionHref }) => ({
      key,
      label,
      state,
      required,
      actionHref: actionHref ?? null
    }))
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpToolValidationError("Tool input must be an object");
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) throw new McpToolValidationError(`Unexpected input field: ${unexpected}`);
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
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
