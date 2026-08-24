import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  McpMediaCapabilityConflictError,
  ContentRepositoryConfigurationError
} from "../content/content-repository.js";
import {
  dailyQuotaWindowStart,
  imageMimeTypes,
  resolveContentCreationAbusePolicy
} from "../content/content-route-shared.js";
import { ImageValidationError, sanitizeImage } from "../content/image-sanitizer.js";
import {
  MediaUploadProviderConfigurationError,
  MediaUploadProviderError
} from "../content/media-upload-adapter.js";
import type { ContentRepository, MediaUploadProviderAdapter } from "../content/types.js";
import type { McpConnection, McpRepository } from "./types.js";

type TokenAccess =
  | { ok: true; connection: McpConnection & { supabaseUserId: string } }
  | { ok: false; statusCode: 401 | 403 | 404 | 503; body: { code: string; message: string } };

export async function registerMcpMediaRoutes(
  app: FastifyInstance,
  options: {
    contentRepository: ContentRepository;
    mediaUploadProvider: MediaUploadProviderAdapter;
    mcpRepository: McpRepository;
  },
  verifyToken: (request: FastifyRequest) => Promise<TokenAccess>
): Promise<void> {
  app.post(
    "/v1/mcp/media/uploads/:capabilityId",
    { bodyLimit: 20 * 1024 * 1024 },
    async (request, reply) => {
      const access = await verifyToken(request);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const params = request.params as { capabilityId?: string };
      const capabilityToken = request.headers["x-wevid-media-capability"];
      if (
        typeof params.capabilityId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.capabilityId) ||
        typeof capabilityToken !== "string" ||
        capabilityToken.length < 32 ||
        capabilityToken.length > 256
      ) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "A capability id and one-time media capability are required"
        });
      }
      if (
        !options.contentRepository.claimMcpMediaUploadCapability ||
        !options.contentRepository.completeMcpMediaUploadCapability ||
        !options.contentRepository.releaseMcpMediaUploadCapability ||
        !options.contentRepository.scheduleMcpMediaProviderCleanup
      ) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Private media handoff is unavailable"
        });
      }

      const declaredMimeType = request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? null;
      const normalizedMimeType = declaredMimeType && imageMimeTypes.has(declaredMimeType)
        ? declaredMimeType
        : null;
      const leaseToken = randomUUID();
      let claimed: Awaited<ReturnType<NonNullable<ContentRepository["claimMcpMediaUploadCapability"]>>> | null = null;
      let providerObject: { providerAssetId: string; assetKind: "image" | "video" } | null = null;
      let completed = false;

      try {
        const policy = await resolveContentCreationAbusePolicy(options.contentRepository);
        claimed = await options.contentRepository.claimMcpMediaUploadCapability({
          capabilityId: params.capabilityId,
          connectionId: access.connection.id,
          supabaseUserId: access.connection.supabaseUserId,
          tokenHash: createHash("sha256").update(capabilityToken).digest("hex"),
          declaredMimeType: normalizedMimeType,
          quotaWindowStart: dailyQuotaWindowStart(new Date(), policy.rollingWindowHours),
          dailyMediaUploadQuota: policy.dailyMediaUploadQuota,
          leaseToken,
          leasedUntil: new Date(Date.now() + 2 * 60 * 1000)
        });

        if (claimed.mediaKind === "image") {
          if (!Buffer.isBuffer(request.body)) {
            throw new ImageValidationError("A supported raw image body is required");
          }
          if (
            !options.mediaUploadProvider.isImageUploadConfigured?.() ||
            !options.mediaUploadProvider.createImageObjectReference ||
            !options.mediaUploadProvider.uploadImageObject
          ) {
            throw new MediaUploadProviderConfigurationError();
          }
          const image = await sanitizeImage(request.body, claimed.mimeType);
          const checksumSha256 = createHash("sha256").update(image.body).digest("hex");
          const providerAssetId = options.mediaUploadProvider.createImageObjectReference({
            contentId: claimed.contentId,
            mediaAssetId: claimed.mediaAssetId,
            extension: image.extension,
            uploadAttemptId: leaseToken
          });
          providerObject = { providerAssetId, assetKind: "image" };
          await options.mediaUploadProvider.uploadImageObject({
            providerAssetId,
            body: image.body,
            mimeType: image.mimeType,
            checksumSha256
          });
          const result = await options.contentRepository.completeMcpMediaUploadCapability({
            capabilityId: claimed.id,
            connectionId: access.connection.id,
            leaseToken,
            providerAssetId,
            providerState: "stored_private",
            widthPixels: image.widthPixels,
            heightPixels: image.heightPixels,
            checksumSha256
          });
          completed = true;
          await options.mcpRepository.touchConnection({ connectionId: access.connection.id });
          return reply.code(201).send({
            mediaAssetId: result.mediaAssetId,
            kind: "image",
            mimeType: claimed.mimeType,
            compositionRevision: result.compositionRevision,
            providerState: "stored_private",
            provenanceReviewState: "pending",
            upload: null
          });
        }

        if (!options.mediaUploadProvider.isConfigured()) {
          throw new MediaUploadProviderConfigurationError();
        }
        if (request.body !== undefined && request.body !== null) {
          throw new ImageValidationError("Video handoff does not accept a request body");
        }
        const providerSession = await options.mediaUploadProvider.createUploadSession({
          contentId: claimed.contentId,
          title: `WeVid private upload ${claimed.contentId.slice(0, 8)}`,
          mimeType: claimed.mimeType,
          ttlSeconds: 60 * 60
        });
        providerObject = { providerAssetId: providerSession.providerAssetId, assetKind: "video" };
        const result = await options.contentRepository.completeMcpMediaUploadCapability({
          capabilityId: claimed.id,
          connectionId: access.connection.id,
          leaseToken,
          providerAssetId: providerSession.providerAssetId,
          providerState: "upload_pending"
        });
        completed = true;
        await options.mcpRepository.touchConnection({ connectionId: access.connection.id });
        return reply.code(201).send({
          mediaAssetId: result.mediaAssetId,
          kind: "video",
          mimeType: claimed.mimeType,
          compositionRevision: result.compositionRevision,
          providerState: "upload_pending",
          provenanceReviewState: "pending",
          upload: {
            uploadUrl: providerSession.uploadUrl,
            provider: providerSession.provider,
            mediaAssetId: result.mediaAssetId,
            headers: providerSession.headers,
            expiresAt: providerSession.expiresAt.toISOString()
          }
        });
      } catch (error) {
        if (claimed && !completed) {
          let cleanupScheduled = false;
          if (providerObject) {
            let providerDeleted = false;
            if (options.mediaUploadProvider.deleteProviderAsset) {
              try {
                await options.mediaUploadProvider.deleteProviderAsset(providerObject);
                providerDeleted = true;
              } catch (cleanupError) {
                request.log.warn({ cleanupError }, "MCP media compensation requires provider retry");
              }
            }
            if (!providerDeleted) {
              await options.contentRepository.scheduleMcpMediaProviderCleanup({
                capabilityId: claimed.id,
                connectionId: access.connection.id,
                leaseToken,
                providerAssetId: providerObject.providerAssetId,
                failureCode: "provider_delete_failed"
              });
              cleanupScheduled = true;
            }
          }
          if (!cleanupScheduled) {
            await options.contentRepository.releaseMcpMediaUploadCapability({
              capabilityId: claimed.id,
              connectionId: access.connection.id,
              leaseToken,
              failureCode: normalizedFailureCode(error)
            });
          }
        }
        if (error instanceof McpMediaCapabilityConflictError) {
          if (error.reason === "quota_exceeded") {
            return reply.code(429).send({ code: "rate_limited", message: "Daily media upload quota has been reached" });
          }
          if (["expired", "consumed"].includes(error.reason)) {
            return reply.code(410).send({ code: "conflict", message: "Media capability is no longer available" });
          }
          if (["busy", "draft_locked", "lease_lost"].includes(error.reason)) {
            return reply.code(409).send({ code: "conflict", message: "Media capability cannot be redeemed in the current draft state" });
          }
          return reply.code(404).send({ code: "not_found", message: "Media capability was not found" });
        }
        if (error instanceof ImageValidationError) {
          return reply.code(400).send({ code: "validation_failed", message: error.message });
        }
        if (error instanceof ContentRepositoryConfigurationError) {
          return reply.code(503).send({ code: "service_unavailable", message: "Private media handoff is unavailable" });
        }
        if (
          error instanceof MediaUploadProviderConfigurationError ||
          error instanceof MediaUploadProviderError
        ) {
          request.log.warn({ error }, "MCP private media provider handoff failed");
          return reply.code(503).send({ code: "service_unavailable", message: "Private media provider is unavailable" });
        }
        throw error;
      }
    }
  );
}

function normalizedFailureCode(error: unknown): string {
  if (error instanceof ImageValidationError) return "image_validation_failed";
  if (error instanceof MediaUploadProviderConfigurationError) return "provider_not_configured";
  if (error instanceof MediaUploadProviderError) return "provider_request_failed";
  if (error instanceof McpMediaCapabilityConflictError) return `capability_${error.reason}`;
  return "media_handoff_failed";
}
