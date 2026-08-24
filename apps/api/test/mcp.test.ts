import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
import type { BuildApiOptions } from "../src/app";
import type { AdminRepository } from "../src/modules/admin/types";
import type { AgeRepository } from "../src/modules/age/types";
import type { AnalyticsRepository } from "../src/modules/analytics/types";
import type { ContentRepository, CreateContentDraftInput, MediaUploadProviderAdapter } from "../src/modules/content/types";
import { ContentDraftPollCloseError, McpMediaCapabilityConflictError } from "../src/modules/content/content-errors";
import { MediaUploadProviderError } from "../src/modules/content/media-upload-adapter";
import type {
  McpConnection,
  McpRepository,
  McpScope,
  McpToolCallAuditInput,
  OAuthAuthorizationCode,
  OAuthAuthorizationRequest,
  OAuthClient
} from "../src/modules/mcp/types";
import type { ProfileRepository } from "../src/modules/profile/types";
import type { SessionRepository, ApplicationSessionVerifier } from "../src/modules/session/types";
import type { WalletRepository } from "../src/modules/wallet/types";

const previousEnv = { ...process.env };
const supabaseUserId = "00000000-0000-4000-8000-000000000001";

describe("external MCP connector foundation", () => {
  beforeEach(() => {
    process.env = {
      ...previousEnv,
      NODE_ENV: "test",
      MCP_ENABLED: "true",
      MCP_AUTH_MODE: "scoped_token",
      MCP_ALLOW_STATIC_TOKENS_DEV: "true",
      MCP_REQUIRE_OAUTH: "false",
      MCP_ALLOWED_CLIENTS: "claude,custom",
      MCP_CONNECTION_TOKEN_TTL_SECONDS: "3600"
    };
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("creates scoped token connections and never returns the token from list/get routes", async () => {
    const mcpRepository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository }));
    await app.ready();

    const created = await app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "mcp-create-1" },
      payload: {
        clientName: "Claude local",
        clientType: "claude",
        roleType: "creator",
        scopes: ["creator.profile.read"]
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      clientName: "Claude local",
      clientType: "claude",
      roleType: "creator",
      tokenHint: expect.any(String)
    });
    expect(created.json().token).toMatch(/^veel_mcp_/);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].token).toBeUndefined();

    await app.close();
  });

  it("rejects creator connections that request admin scopes", async () => {
    const app = await buildApi(testDependencies({ mcpRepository: new FakeMcpRepository() }));
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "mcp-create-2" },
      payload: {
        clientName: "Bad scope",
        clientType: "claude",
        roleType: "creator",
        scopes: ["admin.payments.read"]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_failed" });

    await app.close();
  });

  it("filters MCP tools by token scopes and audits denied scope violations", async () => {
    const mcpRepository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository }));
    await app.ready();
    const token = await createCreatorToken(app);

    const listResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "creator_create_private_draft"
    ]);
    expect(listResponse.json().result.tools[0]).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    });
    expect(listResponse.json().result.tools[0]).not.toHaveProperty("requiredScopes");

    const deniedResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "admin_list_payment_intents", arguments: {} }
      }
    });

    expect(deniedResponse.statusCode).toBe(200);
    expect(deniedResponse.json().error.message).toContain("required tool scope");
    expect(mcpRepository.toolCalls).toMatchObject([{ state: "denied" }]);

    await app.close();
  });

  it("runs a creator draft tool through the content repository without publishing", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository }));
    await app.ready();
    const token = await createCreatorToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "creator_create_private_draft",
          arguments: {
            mediaType: "image",
            caption: "Private draft"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent).toMatchObject({
      draft: {
        contentId: "00000000-0000-4000-8000-000000000099",
        visibility: "private",
        mediaType: "image",
        caption: "Private draft"
      },
      nextAction: "review_in_wevid"
    });
    expect(JSON.parse(response.json().result.content[0].text).draft).toMatchObject({
      mediaType: "image",
      caption: "Private draft"
    });
    expect(contentRepository.createdDrafts).toMatchObject([
      { visibility: "private", nsfwLabel: "none", representationMode: "not_declared" }
    ]);
    expect(mcpRepository.toolCalls).toMatchObject([{
      state: "allowed",
      inputRedacted: { mediaType: "image", caption: "[redacted]" }
    }]);
    expect(contentRepository.createdDrafts[0]?.origin).toMatchObject({
      toolName: "creator_create_private_draft",
      connectionId: expect.any(String),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });

    const retry = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "creator_create_private_draft",
          arguments: { mediaType: "image", caption: "Private draft" }
        }
      }
    });
    expect(retry.statusCode).toBe(200);
    expect(contentRepository.createdDrafts[0]?.idempotencyKey).toBe(contentRepository.createdDrafts[1]?.idempotencyKey);

    const expiredPoll = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "creator_create_private_draft",
          arguments: {
            mediaType: "poll",
            poll: {
              question: "Still open?",
              options: ["Yes", "No"],
              closesAt: "2020-01-01T00:00:00.000Z"
            }
          }
        }
      }
    });
    expect(expiredPoll.statusCode).toBe(200);
    expect(expiredPoll.json().error.message).toContain("future ISO date-time");
    expect(contentRepository.createdDrafts).toHaveLength(2);

    const malformedPoll = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "creator_create_private_draft",
          arguments: {
            mediaType: "poll",
            poll: { question: "When?", options: ["Soon", "Later"], closesAt: "tomorrow" }
          }
        }
      }
    });
    expect(malformedPoll.json().error.message).toContain("future ISO date-time");
    expect(contentRepository.createdDrafts).toHaveLength(2);

    await app.close();
  });

  it("issues hash-only media capabilities and returns minimized provenance readiness", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const uploadedImages: Array<{ body: Buffer; mimeType: string; providerAssetId: string }> = [];
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured: () => true,
      async createUploadSession() { throw new Error("video upload was not expected"); },
      isImageUploadConfigured: () => true,
      createImageObjectReference: ({ contentId, mediaAssetId, extension, uploadAttemptId }) =>
        `images/${contentId}/${mediaAssetId}/${uploadAttemptId}.${extension}`,
      async uploadImageObject(input) { uploadedImages.push(input); },
      async deleteProviderAsset() {}
    };
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository, mediaUploadProvider }));
    await app.ready();
    const token = await createCreatorToken(app, [
      "creator.drafts.write",
      "creator.media.label",
      "creator.drafts.read",
      "creator.media.read"
    ]);
    const requestId = randomUUID();
    const args = {
      requestId,
      contentId: "00000000-0000-4000-8000-000000000099",
      mimeType: "image/webp",
      provenance: {
        originClassification: "ai_generated",
        sourceKind: "generated",
        sourceLineageReference: "urn:wevid:lineage:00000000-0000-4000-8000-000000000401",
        workflowProviderReference: "00000000-0000-4000-8000-000000000402",
        c2paReference: "urn:c2pa:claim:00000000-0000-4000-8000-000000000403"
      }
    };

    const prepared = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 33,
        method: "tools/call",
        params: { name: "creator_prepare_private_media_upload", arguments: args }
      }
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.body).toContain('"result"');
    expect(prepared.json().result.structuredContent.capability).toMatchObject({
      capabilityId: "00000000-0000-4000-8000-000000000301",
      contentId: args.contentId,
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      kind: "image",
      mimeType: "image/webp",
      status: "issued",
      capabilityToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      redeemPath: "/v1/mcp/media/uploads/00000000-0000-4000-8000-000000000301"
    });
    expect(contentRepository.capabilityInputs[0]).toMatchObject({
      mediaKind: "image",
      mimeType: "image/webp",
      originClassification: "ai_generated",
      sourceKind: "generated",
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(contentRepository.capabilityInputs[0]).not.toHaveProperty("capabilityToken");
    expect(JSON.stringify(mcpRepository.toolCalls)).not.toContain(
      prepared.json().result.structuredContent.capability.capabilityToken
    );

    const invalidCapabilityPath = await app.inject({
      method: "POST",
      url: "/v1/mcp/media/uploads/not-a-uuid",
      headers: {
        authorization: `Bearer ${token}`,
        "x-wevid-media-capability": prepared.json().result.structuredContent.capability.capabilityToken,
        "content-type": "image/webp"
      },
      payload: Buffer.from("invalid-path-is-rejected-before-media-work")
    });
    expect(invalidCapabilityPath.statusCode).toBe(400);
    expect(invalidCapabilityPath.json()).toMatchObject({ code: "validation_failed" });
    expect(contentRepository.claimInputs).toHaveLength(0);

    const sourceImage = await sharp({
      create: { width: 7, height: 4, channels: 3, background: { r: 50, g: 120, b: 200 } }
    }).webp().toBuffer();
    const redeemed = await app.inject({
      method: "POST",
      url: prepared.json().result.structuredContent.capability.redeemPath,
      headers: {
        authorization: `Bearer ${token}`,
        "x-wevid-media-capability": prepared.json().result.structuredContent.capability.capabilityToken,
        "content-type": "image/webp"
      },
      payload: sourceImage
    });
    expect(redeemed.statusCode).toBe(201);
    expect(redeemed.json()).toMatchObject({
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      kind: "image",
      mimeType: "image/webp",
      providerState: "stored_private",
      provenanceReviewState: "pending",
      upload: null
    });
    expect(contentRepository.claimInputs[0]).toMatchObject({
      capabilityId: "00000000-0000-4000-8000-000000000301",
      declaredMimeType: "image/webp",
      tokenHash: contentRepository.capabilityInputs[0]?.tokenHash,
      leaseToken: expect.any(String)
    });
    expect(contentRepository.completionInputs[0]).toMatchObject({
      providerState: "stored_private",
      widthPixels: 7,
      heightPixels: 4,
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(uploadedImages).toHaveLength(1);
    expect(uploadedImages[0]!.providerAssetId).toBe(
      `images/${args.contentId}/00000000-0000-4000-8000-000000000302/${contentRepository.claimInputs[0]!.leaseToken}.webp`
    );
    const storedMetadata = await sharp(uploadedImages[0]!.body).metadata();
    expect(storedMetadata.exif).toBeUndefined();
    expect(storedMetadata.orientation).toBeUndefined();
    expect(JSON.stringify(redeemed.json())).not.toContain("providerAssetId");

    const replay = await app.inject({
      method: "POST",
      url: prepared.json().result.structuredContent.capability.redeemPath,
      headers: {
        authorization: `Bearer ${token}`,
        "x-wevid-media-capability": prepared.json().result.structuredContent.capability.capabilityToken,
        "content-type": "image/webp"
      },
      payload: sourceImage
    });
    expect(replay.statusCode).toBe(410);
    expect(uploadedImages).toHaveLength(1);

    contentRepository.capabilityConsumed = false;
    contentRepository.claimFailureReason = "access_ineligible";
    const ineligibleRedemption = await app.inject({
      method: "POST",
      url: prepared.json().result.structuredContent.capability.redeemPath,
      headers: {
        authorization: `Bearer ${token}`,
        "x-wevid-media-capability": prepared.json().result.structuredContent.capability.capabilityToken,
        "content-type": "image/webp"
      },
      payload: sourceImage
    });
    expect(ineligibleRedemption.statusCode).toBe(403);
    expect(ineligibleRedemption.json()).toMatchObject({ code: "forbidden" });
    expect(uploadedImages).toHaveLength(1);
    contentRepository.claimFailureReason = null;

    const mcpCannotReview = await app.inject({
      method: "POST",
      url: "/v1/media/assets/00000000-0000-4000-8000-000000000302/provenance-review",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "mcp-cannot-review" },
      payload: { expectedCompositionRevision: 2, decision: "confirmed" }
    });
    expect(mcpCannotReview.statusCode).toBe(401);

    const malformedReview = await app.inject({
      method: "POST",
      url: "/v1/media/assets/not-a-uuid/provenance-review",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "malformed-review" },
      payload: { expectedCompositionRevision: 2, decision: "confirmed" }
    });
    expect(malformedReview.statusCode).toBe(400);
    expect(malformedReview.json()).toMatchObject({ code: "validation_failed" });
    expect(contentRepository.reviewInputs).toHaveLength(0);

    const oversizedReviewKey = await app.inject({
      method: "POST",
      url: "/v1/media/assets/00000000-0000-4000-8000-000000000302/provenance-review",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "x".repeat(129) },
      payload: { expectedCompositionRevision: 2, decision: "confirmed" }
    });
    expect(oversizedReviewKey.statusCode).toBe(400);
    expect(oversizedReviewKey.json()).toMatchObject({ code: "validation_failed" });
    expect(contentRepository.reviewInputs).toHaveLength(0);

    const reviewed = await app.inject({
      method: "POST",
      url: "/v1/media/assets/00000000-0000-4000-8000-000000000302/provenance-review",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "review-provenance-1" },
      payload: { expectedCompositionRevision: 2, decision: "confirmed" }
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({
      compositionRevision: 3,
      asset: {
        id: "00000000-0000-4000-8000-000000000302",
        provenanceReviewState: "confirmed",
        visibleLabelState: "ai_generated"
      }
    });
    expect(contentRepository.reviewInputs).toMatchObject([{
      expectedCompositionRevision: 2,
      decision: "confirmed",
      idempotencyKey: "review-provenance-1",
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    }]);
    const crossAssetReview = await app.inject({
      method: "POST",
      url: "/v1/media/assets/00000000-0000-4000-8000-000000000303/provenance-review",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "review-provenance-1" },
      payload: { expectedCompositionRevision: 2, decision: "confirmed" }
    });
    expect(crossAssetReview.statusCode).toBe(200);
    expect(contentRepository.reviewInputs[1]?.requestHash)
      .not.toBe(contentRepository.reviewInputs[0]?.requestHash);

    const readiness = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: {
          name: "creator_get_private_media_readiness",
          arguments: { contentId: args.contentId }
        }
      }
    });
    expect(readiness.json().result.structuredContent.readiness).toMatchObject({
      contentId: args.contentId,
      compositionRevision: 2,
      assets: [{
        mediaAssetId: "00000000-0000-4000-8000-000000000302",
        providerState: "processing",
        quarantineState: "pending",
        provenanceReviewState: "pending"
      }],
      blockers: ["media_processing_incomplete", "safety_review_incomplete", "provenance_review_pending"]
    });
    expect(JSON.stringify(readiness.json())).not.toContain("providerAssetId");
    expect(JSON.stringify(readiness.json())).not.toContain("uploadUrl");

    const forbiddenOrigin = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 35,
        method: "tools/call",
        params: {
          name: "creator_prepare_private_media_upload",
          arguments: {
            ...args,
            requestId: randomUUID(),
            provenance: { ...args.provenance, originClassification: "human_created" }
          }
        }
      }
    });
    expect(forbiddenOrigin.json().error.message).toContain("supported AI origin classification");
    expect(contentRepository.capabilityInputs).toHaveLength(1);
    for (const [field, value] of [
      ["sourceLineageReference", "urn:wevid:access_token"],
      ["sourceLineageReference", "https://example.test/access%255ftoken/SECRET"],
      ["workflowProviderReference", "client-secret"],
      ["c2paReference", "https://creator:password@example.test/claim"]
    ] as const) {
      const rejectedReference = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          jsonrpc: "2.0",
          id: 36,
          method: "tools/call",
          params: {
            name: "creator_prepare_private_media_upload",
            arguments: {
              ...args,
              requestId: randomUUID(),
              provenance: { ...args.provenance, [field]: value }
            }
          }
        }
      });
      expect(rejectedReference.json().error.message).toContain("cannot contain prompts or credentials");
    }
    expect(contentRepository.capabilityInputs).toHaveLength(1);
    for (const [field, value] of [
      ["sourceLineageReference", "https://example.test/users/alice@example.com"],
      ["sourceLineageReference", "https://example.test/lineage/alice-smith"],
      ["workflowProviderReference", "alice-smith"],
      ["c2paReference", "urn:c2pa:claim:alice-smith"]
    ] as const) {
      const rejectedPersonalReference = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          jsonrpc: "2.0",
          id: 37,
          method: "tools/call",
          params: {
            name: "creator_prepare_private_media_upload",
            arguments: {
              ...args,
              requestId: randomUUID(),
              provenance: { ...args.provenance, [field]: value }
            }
          }
        }
      });
      expect(rejectedPersonalReference.json().error.message).toMatch(/provider-controlled opaque|opaque provider identifier/);
    }
    expect(contentRepository.capabilityInputs).toHaveLength(1);
    await app.close();
  });

  it("returns a newly issued capability when ancillary MCP persistence fails", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository }));
    await app.ready();
    const token = await createCreatorToken(app, ["creator.drafts.write", "creator.media.label"]);
    mcpRepository.recordToolCall = async () => {
      throw new Error("ancillary audit persistence unavailable");
    };

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 37,
        method: "tools/call",
        params: {
          name: "creator_prepare_private_media_upload",
          arguments: {
            requestId: randomUUID(),
            contentId: "00000000-0000-4000-8000-000000000099",
            mimeType: "image/webp",
            provenance: { originClassification: "ai_generated", sourceKind: "generated" }
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent.capability).toMatchObject({
      status: "issued",
      capabilityToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    });
    expect(contentRepository.capabilityInputs).toHaveLength(1);
    await app.close();
  });

  it("returns a completed video handoff when connection activity persistence fails", async () => {
    const mcpRepository = new FakeMcpRepository();
    mcpRepository.touchConnection = async () => {
      throw new Error("activity persistence unavailable");
    };
    const contentRepository = new FakeContentRepository();
    const capabilityToken = "v".repeat(43);
    contentRepository.capabilityInputs.push({
      connectionId: "00000000-0000-4000-8000-000000000399",
      supabaseUserId,
      contentId: "00000000-0000-4000-8000-000000000099",
      requestHash: "a".repeat(64),
      tokenHash: createHash("sha256").update(capabilityToken).digest("hex"),
      mediaKind: "video",
      mimeType: "video/mp4",
      expiresAt: new Date(Date.now() + 60_000),
      originClassification: "ai_generated",
      sourceKind: "generated",
      sourceLineageReference: null,
      workflowProviderReference: null,
      c2paReference: null
    });
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured: () => true,
      async createUploadSession() {
        return {
          provider: "bunny",
          providerAssetId: "touch-failure-video",
          uploadUrl: "https://video.bunnycdn.com/tusupload",
          headers: { AuthorizationSignature: "safe-signature" },
          expiresAt: new Date("2026-08-24T12:00:00.000Z")
        };
      },
      async deleteProviderAsset() {
        throw new Error("completed provider asset must not be compensated");
      }
    };
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository, mediaUploadProvider }));
    await app.ready();
    const mcpToken = await createCreatorToken(app, ["creator.drafts.write", "creator.media.label"]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/mcp/media/uploads/00000000-0000-4000-8000-000000000301",
      headers: {
        authorization: `Bearer ${mcpToken}`,
        "x-wevid-media-capability": capabilityToken
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      kind: "video",
      providerState: "upload_pending",
      upload: {
        uploadUrl: "https://video.bunnycdn.com/tusupload",
        provider: "bunny",
        headers: { AuthorizationSignature: "safe-signature" }
      }
    });
    expect(contentRepository.completionInputs).toHaveLength(1);
    expect(contentRepository.releaseInputs).toHaveLength(0);
    expect(contentRepository.cleanupInputs).toHaveLength(0);
    await app.close();
  });

  it("moves an ambiguously stored image into durable cleanup when immediate compensation fails", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const capabilityToken = "c".repeat(43);
    contentRepository.capabilityInputs.push({
      connectionId: "00000000-0000-4000-8000-000000000399",
      supabaseUserId,
      contentId: "00000000-0000-4000-8000-000000000099",
      requestHash: "a".repeat(64),
      tokenHash: createHash("sha256").update(capabilityToken).digest("hex"),
      mediaKind: "image",
      mimeType: "image/webp",
      expiresAt: new Date(Date.now() + 60_000),
      originClassification: "ai_generated",
      sourceKind: "generated",
      sourceLineageReference: null,
      workflowProviderReference: null,
      c2paReference: null
    });
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured: () => true,
      async createUploadSession() { throw new Error("video upload was not expected"); },
      isImageUploadConfigured: () => true,
      createImageObjectReference: ({ contentId, mediaAssetId, extension, uploadAttemptId }) =>
        `images/${contentId}/${mediaAssetId}/${uploadAttemptId}.${extension}`,
      async uploadImageObject() { throw new MediaUploadProviderError(); },
      async deleteProviderAsset() { throw new MediaUploadProviderError(); }
    };
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository, mediaUploadProvider }));
    await app.ready();
    const mcpToken = await createCreatorToken(app, ["creator.drafts.write", "creator.media.label"]);
    const sourceImage = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 20, g: 40, b: 60 } }
    }).webp().toBuffer();

    const response = await app.inject({
      method: "POST",
      url: "/v1/mcp/media/uploads/00000000-0000-4000-8000-000000000301",
      headers: {
        authorization: `Bearer ${mcpToken}`,
        "x-wevid-media-capability": capabilityToken,
        "content-type": "image/webp"
      },
      payload: sourceImage
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("images/");
    expect(contentRepository.completionInputs).toHaveLength(0);
    expect(contentRepository.releaseInputs).toHaveLength(0);
    expect(contentRepository.cleanupInputs).toMatchObject([{
      capabilityId: "00000000-0000-4000-8000-000000000301",
      providerAssetId: expect.stringMatching(
        /^images\/00000000-0000-4000-8000-000000000099\/00000000-0000-4000-8000-000000000302\/[0-9a-f-]{36}\.webp$/
      ),
      failureCode: "provider_delete_failed"
    }]);
    await app.close();
  });

  it("negotiates the stable protocol and rejects untrusted browser origins", async () => {
    const app = await buildApi(testDependencies({ mcpRepository: new FakeMcpRepository() }));
    await app.ready();
    const token = await createCreatorToken(app, ["creator.profile.read"]);

    const initialized = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, origin: "http://localhost:3000" },
      payload: {
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" }
      }
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "wevid", version: "0.2.0" }
    });

    const initializedNotification = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-11-25" },
      payload: { jsonrpc: "2.0", method: "notifications/initialized" }
    });
    expect(initializedNotification.statusCode).toBe(202);

    const unsupportedProtocol = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "mcp-protocol-version": "2099-01-01" },
      payload: { jsonrpc: "2.0", id: 13, method: "tools/list" }
    });
    expect(unsupportedProtocol.statusCode).toBe(400);
    expect(unsupportedProtocol.json()).toMatchObject({ code: "invalid_protocol_version" });

    const rejected = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, origin: "https://attacker.example" },
      payload: { jsonrpc: "2.0", id: 11, method: "tools/list" }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "forbidden" });

    const malformedOrigin = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, origin: "http://localhost:3000/path" },
      payload: { jsonrpc: "2.0", id: 12, method: "tools/list" }
    });
    expect(malformedOrigin.statusCode).toBe(403);

    const getRejected = await app.inject({ method: "GET", url: "/mcp" });
    expect(getRejected.statusCode).toBe(405);
    expect(getRejected.headers.allow).toBe("POST");

    await app.close();
  });

  it("returns minimized profile, canonical analytics, and owned private-draft readiness", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository }));
    await app.ready();
    const token = await createCreatorToken(app, [
      "creator.profile.read",
      "creator.metrics.read",
      "creator.drafts.read"
    ]);

    const call = (id: number, name: string, args: Record<string, unknown> = {}) => app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }
    });

    const profile = await call(20, "creator_get_profile");
    expect(profile.json().result.structuredContent).toMatchObject({
      profile: { handle: "creator", displayName: "Creator" },
      readiness: { state: "active", canMonetize: true },
      onboarding: { state: "ready", canStartEarning: true }
    });
    expect(profile.json().result.structuredContent.profile).not.toHaveProperty("id");
    expect(profile.json().result.structuredContent).not.toHaveProperty("earnings");
    expect(profile.json().result.structuredContent.onboarding).not.toHaveProperty("configuration");

    const analytics = await call(21, "creator_query_analytics", {
      metricKeys: ["creator.content.impressions"],
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      granularity: "total"
    });
    expect(analytics.json().result.structuredContent.analytics).toMatchObject({
      scope: { type: "creator" },
      freshness: "fresh",
      metrics: [{ points: [{ value: null, privacyDecision: "suppressed_minimum_cohort" }] }]
    });
    expect(analytics.json().result.structuredContent.analytics.scope).not.toHaveProperty("creatorUserId");

    const drafts = await call(22, "creator_list_private_drafts", { limit: 5 });
    expect(drafts.json().result.structuredContent.items).toMatchObject([{
      contentId: "00000000-0000-4000-8000-000000000099"
    }]);
    expect(drafts.json().result.structuredContent.items[0]).not.toHaveProperty("visibility");
    expect(contentRepository.listInputs).toMatchObject([{ privateDraftsOnly: true }]);
    expect(drafts.json().result.structuredContent.items[0]).not.toHaveProperty("posterUrl");
    expect(drafts.json().result.structuredContent.items[0]).not.toHaveProperty("caption");
    expect(drafts.json().result.structuredContent.items[0]).not.toHaveProperty("reviewMessage");

    const readiness = await call(23, "creator_get_draft_readiness", {
      contentId: "00000000-0000-4000-8000-000000000099"
    });
    expect(readiness.json().result.structuredContent.readiness).toMatchObject({
      reviewRequestEligible: true,
      nextAction: "continue_in_wevid"
    });

    const denied = await call(24, "creator_get_draft_readiness", {
      contentId: "00000000-0000-4000-8000-000000000098"
    });
    expect(denied.json().error.message).toContain("Owned private draft not found");

    await app.close();
  });
});

describe("MCP OAuth completion", () => {
  beforeEach(() => {
    process.env = {
      ...previousEnv,
      NODE_ENV: "test",
      API_URL: "http://localhost:4000",
      WEB_URL: "http://localhost:3000",
      MCP_ENABLED: "true",
      MCP_AUTH_MODE: "oauth",
      MCP_REQUIRE_OAUTH: "true",
      MCP_ALLOWED_CLIENTS: "claude,custom",
      MCP_CONNECTION_TOKEN_TTL_SECONDS: "3600",
      MCP_OAUTH_AUTH_CODE_TTL_SECONDS: "600",
      MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "3600"
    };
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("publishes OAuth metadata without dynamic client registration or refresh token support", async () => {
    const app = await buildApi(testDependencies({ mcpRepository: new FakeMcpRepository() }));
    await app.ready();

    const protectedResource = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource"
    });
    const authorizationServer = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server"
    });

    expect(protectedResource.statusCode).toBe(200);
    expect(protectedResource.json()).toMatchObject({
      resource: "http://localhost:4000/mcp",
      authorization_servers: ["http://localhost:4000"]
    });
    expect(authorizationServer.statusCode).toBe(200);
    expect(authorizationServer.json().registration_endpoint).toBeUndefined();
    expect(authorizationServer.json().grant_types_supported).toEqual(["authorization_code"]);

    await app.close();
  });

  it("rejects authorize requests without S256 PKCE and redirects valid requests to consent", async () => {
    const repository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const invalid = await app.inject({
      method: "GET",
      url: "/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read"
    });
    expect(invalid.statusCode).toBe(400);

    const { challenge } = pkcePair();
    const valid = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read&state=abc&code_challenge=${challenge}&code_challenge_method=S256`
    });

    expect(valid.statusCode).toBe(302);
    expect(valid.headers.location).toMatch(/^http:\/\/localhost:3000\/oauth\/mcp\/consent\?requestId=/);
    expect(repository.authorizationRequests).toHaveLength(1);

    await app.close();
  });

  it("approves consent, exchanges a single-use code, authorizes MCP, and revokes the token", async () => {
    const repository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const { verifier, challenge } = pkcePair();
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read&state=state-1&code_challenge=${challenge}&code_challenge_method=S256`
    });
    const requestId = new URL(authorize.headers.location as string).searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({
      clientName: "Claude test",
      requestedScopes: ["creator.profile.read"]
    });

    const approval = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(approval.statusCode).toBe(200);
    const callback = new URL(approval.json().redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-1");
    const code = callback.searchParams.get("code");
    expect(code).toMatch(/^veel_oauth_/);

    const wrongVerifier = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong"
      }
    });
    expect(wrongVerifier.statusCode).toBe(400);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: verifier
      }
    });
    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.json()).toMatchObject({
      token_type: "Bearer",
      scope: "creator.profile.read"
    });

    const reuse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: verifier
      }
    });
    expect(reuse.statusCode).toBe(400);

    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${tokenResponse.json().access_token}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(mcp.statusCode).toBe(200);
    expect(mcp.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(["creator_get_profile"]);

    const revoke = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: { token: tokenResponse.json().access_token }
    });
    expect(revoke.statusCode).toBe(200);

    const denied = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${tokenResponse.json().access_token}` },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" }
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["www-authenticate"]).toContain("resource_metadata=");

    await app.close();
  });

  it("rejects admin OAuth scopes when the staff role is not allowed for that scope", async () => {
    const repository = new FakeMcpRepository();
    repository.staffRoles = ["finance"];
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const { challenge } = pkcePair();
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-admin-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=admin.support.read&code_challenge=${challenge}&code_challenge_method=S256`
    });
    const requestId = new URL(authorize.headers.location as string).searchParams.get("requestId");

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(consent.statusCode).toBe(403);

    await app.close();
  });
});

async function createCreatorToken(
  app: Awaited<ReturnType<typeof buildApi>>,
  scopes: McpScope[] = ["creator.drafts.write"]
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/mcp/connections",
    headers: { authorization: "Bearer valid-token", "idempotency-key": `mcp-create-${randomUUID()}` },
    payload: {
      clientName: "Claude local",
      clientType: "claude",
      roleType: "creator",
      scopes
    }
  });

  return created.json().token;
}

function testDependencies(input: {
  mcpRepository: McpRepository;
  contentRepository?: FakeContentRepository;
  mediaUploadProvider?: MediaUploadProviderAdapter;
}): BuildApiOptions {
  return {
    authVerifier: fakeAuthVerifier,
    sessionRepository: fakeSessionRepository,
    ageRepository: fakeAgeRepository,
    analyticsRepository: fakeAnalyticsRepository,
    walletRepository: fakeWalletRepository,
    profileRepository: fakeProfileRepository,
    contentRepository: (input.contentRepository ?? new FakeContentRepository()) as unknown as ContentRepository,
    ...(input.mediaUploadProvider ? { mediaUploadProvider: input.mediaUploadProvider } : {}),
    adminRepository: fakeAdminRepository,
    mcpRepository: input.mcpRepository
  };
}

const fakeAuthVerifier: ApplicationSessionVerifier = {
  async verifyToken(token) {
    return token === "valid-token" ? {
      userId: supabaseUserId,
      supabaseUserId,
      sessionId: "00000000-0000-4000-8000-000000000099",
      authenticatedAt: new Date(),
      authenticationMethod: "wallet"
    } : null;
  }
};

const fakeSessionRepository: SessionRepository = {
  async findProfileByUserId() {
    return this.findProfileBySupabaseUserId(supabaseUserId);
  },
  async findProfileBySupabaseUserId() {
    return {
      id: "00000000-0000-4000-8000-000000000010",
      state: "active",
      handle: "creator",
      displayName: "Creator",
      avatarUrl: null
    };
  }
};

const fakeAgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return { state: "verified" };
  },
  async createPendingAgeVerification() {},
  async applyProviderWebhook() {
    return "applied";
  },
  async updateVerificationFromWebhook() {
    return true;
  }
} as unknown as AgeRepository;

const fakeWalletRepository = {
  async hasWalletBySupabaseUserId() {
    return true;
  }
} as unknown as WalletRepository;

const fakeProfileRepository = {
  async getMyCreatorDashboard() {
    return {
      creator: { id: supabaseUserId, handle: "creator", displayName: "Creator", avatarUrl: null, badges: [] },
      readiness: {
        state: "active",
        earningState: "ready",
        kycState: "verified",
        taxProfileState: "verified",
        recipientWalletState: "linked",
        readinessScore: 100,
        canMonetize: true,
        nextAction: null,
        policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
        blockedReasons: []
      },
      earnings: {},
      products: [],
      recentActivity: []
    };
  },
  async getMyCreatorOnboarding() {
    return {
      state: "ready",
      canStartEarning: true,
      readinessScore: 100,
      nextAction: null,
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
      configuration: { recipientWalletId: null, earningsTermsVersion: null, products: {} },
      steps: [{ key: "profile", label: "Profile", state: "complete", required: true, actionHref: null }]
    };
  }
} as unknown as ProfileRepository;

const fakeAnalyticsRepository = {
  async authorizeScope() {
    return { type: "creator", creatorUserId: supabaseUserId };
  },
  async queryMetric() {
    return [{ bucketDate: null, value: "3", numerator: null, denominator: null, sampleSize: "3" }];
  },
  async getWatermark() {
    return { definitionVersion: 1, dataThrough: new Date(), state: "healthy" };
  },
  async recordSuppression() {},
  async recordOnboardingEvent() {},
  async getProjectionHealth() {
    return {};
  },
  async enqueueProjectionJob() {
    return {};
  }
} as unknown as AnalyticsRepository;

const fakeAdminRepository = {
  async hasAdminAccess() {
    return true;
  },
  async getOpsSummary() {
    return { status: "ok" };
  },
  async listSupportCases() {
    return { items: [], nextCursor: null };
  },
  async listPaymentIntents() {
    return { items: [], nextCursor: null };
  }
} as unknown as AdminRepository;

class FakeContentRepository {
  readonly createdDrafts: CreateContentDraftInput[] = [];
  readonly listInputs: Parameters<NonNullable<ContentRepository["listOwnedContent"]>>[0][] = [];
  readonly capabilityInputs: Parameters<NonNullable<ContentRepository["issueMcpMediaUploadCapability"]>>[0][] = [];
  readonly claimInputs: Parameters<NonNullable<ContentRepository["claimMcpMediaUploadCapability"]>>[0][] = [];
  readonly completionInputs: Parameters<NonNullable<ContentRepository["completeMcpMediaUploadCapability"]>>[0][] = [];
  readonly reviewInputs: Parameters<NonNullable<ContentRepository["reviewOwnedMediaAssetProvenance"]>>[0][] = [];
  readonly releaseInputs: Parameters<NonNullable<ContentRepository["releaseMcpMediaUploadCapability"]>>[0][] = [];
  readonly cleanupInputs: Parameters<NonNullable<ContentRepository["scheduleMcpMediaProviderCleanup"]>>[0][] = [];
  capabilityConsumed = false;
  claimFailureReason: "access_ineligible" | null = null;

  async createDraft(input: CreateContentDraftInput) {
    if (input.poll?.closesAt && Date.parse(input.poll.closesAt) <= Date.now()) {
      throw new ContentDraftPollCloseError();
    }
    this.createdDrafts.push(input);
    return {
      id: "00000000-0000-4000-8000-000000000099",
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "creator",
        displayName: "Creator",
        avatarUrl: null,
        badges: []
      },
      mediaType: input.mediaType,
      caption: input.caption ?? null,
      accessState: "free",
      nsfwLabel: input.nsfwLabel,
      engagement: { liked: false, saved: false, likeCount: 0, commentCount: 0 }
    };
  }

  async listOwnedContent(input: Parameters<NonNullable<ContentRepository["listOwnedContent"]>>[0]) {
    this.listInputs.push(input);
    return {
      items: [{
        id: "00000000-0000-4000-8000-000000000099",
        mediaType: "image" as const,
        caption: "Private draft",
        posterUrl: "https://private.example/poster.jpg",
        visibility: "private",
        publicationState: "draft" as const,
        reviewState: "ready",
        reviewMessage: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      }],
      nextCursor: null
    };
  }

  async findOwnedPrivateDraftReadiness(input: { supabaseUserId: string; contentId: string }) {
    if (input.supabaseUserId !== supabaseUserId || input.contentId !== "00000000-0000-4000-8000-000000000099") return null;
    return {
      contentId: input.contentId,
      mediaType: "image" as const,
      publicationState: "draft" as const,
      reviewState: "ready",
      reviewRequestEligible: true,
      assetCount: 1,
      blockers: [],
      nextAction: "continue_in_wevid" as const
    };
  }

  async issueMcpMediaUploadCapability(
    input: Parameters<NonNullable<ContentRepository["issueMcpMediaUploadCapability"]>>[0]
  ) {
    this.capabilityInputs.push(input);
    return {
      id: "00000000-0000-4000-8000-000000000301",
      contentId: input.contentId,
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      mediaKind: input.mediaKind,
      mimeType: input.mimeType,
      expiresAt: input.expiresAt.toISOString(),
      issued: true
    };
  }

  async findOwnedPrivateMediaReadiness(input: { supabaseUserId: string; contentId: string }) {
    if (input.supabaseUserId !== supabaseUserId) return null;
    return {
      contentId: input.contentId,
      compositionRevision: 2,
      assets: [{
        mediaAssetId: "00000000-0000-4000-8000-000000000302",
        kind: "image" as const,
        mimeType: "image/webp" as const,
        providerState: "processing" as const,
        quarantineState: "pending" as const,
        provenanceReviewState: "pending" as const,
        visibleLabelState: "ai_generated" as const,
        machineReadableMarkingState: "pending" as const
      }],
      blockers: ["media_processing_incomplete", "safety_review_incomplete", "provenance_review_pending"]
    };
  }

  async claimMcpMediaUploadCapability(
    input: Parameters<NonNullable<ContentRepository["claimMcpMediaUploadCapability"]>>[0]
  ) {
    this.claimInputs.push(input);
    if (this.claimFailureReason) throw new McpMediaCapabilityConflictError(this.claimFailureReason);
    if (this.capabilityConsumed) throw new McpMediaCapabilityConflictError("consumed");
    const issued = this.capabilityInputs[0];
    if (!issued || input.tokenHash !== issued.tokenHash) throw new McpMediaCapabilityConflictError("mismatch");
    return {
      id: input.capabilityId,
      contentId: issued.contentId,
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      mediaKind: issued.mediaKind,
      mimeType: issued.mimeType,
      leaseToken: input.leaseToken,
      originClassification: issued.originClassification,
      sourceKind: issued.sourceKind,
      sourceLineageReference: issued.sourceLineageReference ?? null,
      workflowProviderReference: issued.workflowProviderReference ?? null,
      c2paReference: issued.c2paReference ?? null
    };
  }

  async completeMcpMediaUploadCapability(
    input: Parameters<NonNullable<ContentRepository["completeMcpMediaUploadCapability"]>>[0]
  ) {
    this.completionInputs.push(input);
    this.capabilityConsumed = true;
    return {
      mediaAssetId: "00000000-0000-4000-8000-000000000302",
      contentId: "00000000-0000-4000-8000-000000000099",
      compositionRevision: 2
    };
  }

  async releaseMcpMediaUploadCapability(
    input: Parameters<NonNullable<ContentRepository["releaseMcpMediaUploadCapability"]>>[0]
  ) { this.releaseInputs.push(input); }
  async scheduleMcpMediaProviderCleanup(
    input: Parameters<NonNullable<ContentRepository["scheduleMcpMediaProviderCleanup"]>>[0]
  ) { this.cleanupInputs.push(input); }

  async reviewOwnedMediaAssetProvenance(
    input: Parameters<NonNullable<ContentRepository["reviewOwnedMediaAssetProvenance"]>>[0]
  ) {
    this.reviewInputs.push(input);
    if (input.expectedCompositionRevision !== 2) throw new McpMediaCapabilityConflictError("draft_locked");
    return {
      compositionRevision: 3,
      asset: {
        id: input.mediaAssetId,
        kind: "image" as const,
        position: 0,
        provider: "bunny" as const,
        providerState: "stored_private",
        posterUrl: null,
        mimeType: "image/webp" as const,
        widthPixels: 7,
        heightPixels: 4,
        durationMs: null,
        altText: null,
        requiredForRelease: true,
        isCover: false,
        focalPointX: null,
        focalPointY: null,
        originClassification: "ai_generated" as const,
        visibleLabelState: "ai_generated" as const,
        provenanceReviewState: input.decision,
        machineReadableMarkingState: "pending" as const
      }
    };
  }
}

class FakeMcpRepository implements McpRepository {
  readonly connections = new Map<string, McpConnection & { supabaseUserId: string; tokenHash: string }>();
  readonly oauthAccessTokens = new Map<string, McpConnection & {
    supabaseUserId: string;
    oauthTokenId: string;
    oauthClientId: string;
    resource: string;
    audience: string;
    tokenHash: string;
    tokenExpiresAt: string;
    tokenRevokedAt: string | null;
  }>();
  readonly authorizationRequests: OAuthAuthorizationRequest[] = [];
  readonly authorizationCodes = new Map<string, OAuthAuthorizationCode & { codeHash: string }>();
  readonly toolCalls: McpToolCallAuditInput[] = [];
  staffRoles = ["owner"];
  readonly clients: OAuthClient[] = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      clientId: "claude-test",
      clientName: "Claude test",
      clientType: "claude",
      clientMode: "public",
      allowedRedirectUris: ["http://localhost:8787/callback"],
      allowedScopes: ["creator.profile.read", "creator.drafts.write"],
      status: "active"
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      clientId: "claude-admin-test",
      clientName: "Claude admin test",
      clientType: "claude",
      clientMode: "public",
      allowedRedirectUris: ["http://localhost:8787/callback"],
      allowedScopes: ["admin.health.read", "admin.support.read", "admin.payments.read"],
      status: "active"
    }
  ];

  async createConnection(input: Parameters<McpRepository["createConnection"]>[0]) {
    const connection = {
      id: randomUUID(),
      supabaseUserId: input.supabaseUserId,
      clientName: input.clientName,
      clientType: input.clientType,
      authMode: "scoped_token" as const,
      roleType: input.roleType,
      state: "active" as const,
      tokenHash: input.tokenHash,
      tokenHint: input.tokenHint,
      scopes: input.scopes,
      expiresAt: input.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.connections.set(connection.id, connection);
    return stripHash(connection);
  }

  async createOAuthConnection(input: Parameters<McpRepository["createOAuthConnection"]>[0]) {
    const connection = {
      id: randomUUID(),
      supabaseUserId: input.supabaseUserId,
      clientName: input.clientName,
      clientType: input.clientType,
      authMode: "oauth" as const,
      roleType: input.roleType,
      state: "active" as const,
      tokenHash: "",
      tokenHint: null,
      scopes: input.scopes,
      expiresAt: input.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.connections.set(connection.id, connection);
    return stripHash(connection);
  }

  async listConnections() {
    return {
      items: [...this.connections.values()].map(stripHash),
      nextCursor: null
    };
  }

  async findConnectionForUser(input: Parameters<McpRepository["findConnectionForUser"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    return connection?.supabaseUserId === input.supabaseUserId ? stripHash(connection) : null;
  }

  async findConnectionByTokenHash(input: Parameters<McpRepository["findConnectionByTokenHash"]>[0]) {
    return [...this.connections.values()]
      .filter((connection) => connection.tokenHash === input.tokenHash)
      .map((connection) => ({ ...stripHash(connection), supabaseUserId: connection.supabaseUserId }))[0] ?? null;
  }

  async findOAuthClientByClientId(input: Parameters<McpRepository["findOAuthClientByClientId"]>[0]) {
    return this.clients.find((client) => client.clientId === input.clientId) ?? null;
  }

  async createOAuthAuthorizationRequest(input: Parameters<McpRepository["createOAuthAuthorizationRequest"]>[0]) {
    const client = this.clients.find((item) => item.id === input.oauthClientId);
    if (!client) throw new Error("missing test client");
    const request: OAuthAuthorizationRequest = {
      id: randomUUID(),
      clientId: client.id,
      publicClientId: client.clientId,
      clientName: client.clientName,
      clientType: client.clientType,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      state: input.state,
      resource: input.resource,
      audience: input.audience,
      roleType: input.roleType,
      requestedScopes: input.requestedScopes,
      approvedScopes: null,
      status: "pending",
      expiresAt: input.expiresAt.toISOString(),
      createdAt: new Date().toISOString()
    };
    this.authorizationRequests.push(request);
    return request;
  }

  async findOAuthAuthorizationRequest(input: Parameters<McpRepository["findOAuthAuthorizationRequest"]>[0]) {
    return this.authorizationRequests.find((request) => request.id === input.requestId) ?? null;
  }

  async approveOAuthAuthorizationRequest(input: Parameters<McpRepository["approveOAuthAuthorizationRequest"]>[0]) {
    const request = this.authorizationRequests.find((item) => item.id === input.requestId);
    if (!request || request.status !== "pending") return null;
    const connection = await this.createOAuthConnection({
      supabaseUserId: input.supabaseUserId,
      oauthClientId: request.clientId,
      clientName: request.clientName,
      clientType: request.clientType,
      roleType: request.roleType,
      scopes: input.approvedScopes,
      expiresAt: input.connectionExpiresAt
    });
    const code: OAuthAuthorizationCode & { codeHash: string } = {
      id: randomUUID(),
      clientId: request.clientId,
      publicClientId: request.publicClientId,
      connectionId: connection.id,
      supabaseUserId: input.supabaseUserId,
      roleType: request.roleType,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      resource: request.resource,
      audience: request.audience,
      scopes: input.approvedScopes,
      expiresAt: input.codeExpiresAt.toISOString(),
      usedAt: null,
      codeHash: input.codeHash
    };
    request.status = "approved";
    request.approvedScopes = input.approvedScopes;
    this.authorizationCodes.set(code.id, code);
    return code;
  }

  async denyOAuthAuthorizationRequest(input: Parameters<McpRepository["denyOAuthAuthorizationRequest"]>[0]) {
    const request = this.authorizationRequests.find((item) => item.id === input.requestId);
    if (!request || request.status !== "pending") return null;
    request.status = "denied";
    return request;
  }

  async findOAuthAuthorizationCodeByHash(input: Parameters<McpRepository["findOAuthAuthorizationCodeByHash"]>[0]) {
    return [...this.authorizationCodes.values()].find((code) => code.codeHash === input.codeHash) ?? null;
  }

  async markOAuthAuthorizationCodeUsed(input: Parameters<McpRepository["markOAuthAuthorizationCodeUsed"]>[0]) {
    const code = this.authorizationCodes.get(input.codeId);
    if (code) code.usedAt = new Date().toISOString();
  }

  async issueOAuthAccessToken(input: Parameters<McpRepository["issueOAuthAccessToken"]>[0]) {
    const code = this.authorizationCodes.get(input.codeId);
    if (!code) throw new Error("missing code");
    const connection = this.connections.get(code.connectionId);
    if (!connection) throw new Error("missing connection");
    const token = {
      ...stripHash(connection),
      supabaseUserId: connection.supabaseUserId,
      oauthTokenId: randomUUID(),
      oauthClientId: code.clientId,
      resource: code.resource,
      audience: code.audience,
      tokenHash: input.tokenHash,
      tokenExpiresAt: input.expiresAt.toISOString(),
      tokenRevokedAt: null
    };
    this.oauthAccessTokens.set(token.oauthTokenId, token);
    return { expiresAt: token.tokenExpiresAt, scopes: code.scopes };
  }

  async findConnectionByOAuthAccessTokenHash(input: Parameters<McpRepository["findConnectionByOAuthAccessTokenHash"]>[0]) {
    return [...this.oauthAccessTokens.values()].find((token) =>
      token.tokenHash === input.tokenHash &&
      token.tokenRevokedAt === null &&
      new Date(token.tokenExpiresAt).getTime() > Date.now()
    ) ?? null;
  }

  async revokeOAuthAccessTokenHash(input: Parameters<McpRepository["revokeOAuthAccessTokenHash"]>[0]) {
    for (const token of this.oauthAccessTokens.values()) {
      if (token.tokenHash === input.tokenHash) {
        token.tokenRevokedAt = new Date().toISOString();
      }
    }
  }

  async listActiveStaffRoles() {
    return this.staffRoles;
  }

  async revokeConnection(input: Parameters<McpRepository["revokeConnection"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    if (!connection || connection.supabaseUserId !== input.supabaseUserId) return null;
    connection.state = "revoked";
    connection.revokedAt = new Date().toISOString();
    for (const token of this.oauthAccessTokens.values()) {
      if (token.id === connection.id) {
        token.tokenRevokedAt = new Date().toISOString();
      }
    }
    return stripHash(connection);
  }

  async touchConnection(input: Parameters<McpRepository["touchConnection"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    if (connection) connection.lastUsedAt = new Date().toISOString();
  }

  async recordToolCall(input: McpToolCallAuditInput) {
    this.toolCalls.push(input);
  }

}

function stripHash(
  connection: McpConnection & { supabaseUserId: string; tokenHash: string }
): McpConnection {
  return {
    id: connection.id,
    clientName: connection.clientName,
    clientType: connection.clientType,
    authMode: connection.authMode,
    roleType: connection.roleType,
    state: connection.state,
    tokenHint: connection.tokenHint,
    scopes: connection.scopes as McpScope[],
    expiresAt: connection.expiresAt,
    lastUsedAt: connection.lastUsedAt,
    revokedAt: connection.revokedAt,
    createdAt: connection.createdAt
  };
}

function pkcePair() {
  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
