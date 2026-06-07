import type { FastifyInstance } from "fastify";
import { ContentRepositoryConfigurationError } from "./content-repository.js";
import {
  MediaUploadProviderConfigurationError,
  MediaUploadProviderError
} from "./media-upload-adapter.js";
import type { CreateUploadRequest } from "./types.js";
import {
  verifyAppReadyAccess,
  videoMimeTypes,
  type RegisterContentRoutesOptions
} from "./content-route-shared.js";

export async function registerContentUploadRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  app.post("/v1/media/uploads", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<CreateUploadRequest> | undefined;

    if (
      !body ||
      typeof body.contentId !== "string" ||
      typeof body.fileName !== "string" ||
      typeof body.mimeType !== "string" ||
      !videoMimeTypes.has(body.mimeType)
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId, fileName, and supported video mimeType are required"
      });
    }

    try {
      const content = await options.contentRepository.findOwnedContentForUpload({
        supabaseUserId: access.supabaseUserId,
        contentId: body.contentId
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content draft was not found"
        });
      }

      if (!options.mediaUploadProvider.isConfigured()) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media upload provider is not configured"
        });
      }

      const providerSession = await options.mediaUploadProvider.createUploadSession({
        contentId: content.id,
        title: content.caption || body.fileName,
        mimeType: body.mimeType
      });

      await options.contentRepository.createMediaAsset({
        contentId: content.id,
        provider: providerSession.provider,
        providerAssetId: providerSession.providerAssetId,
        providerState: "created"
      });

      return reply.code(201).send({
        uploadUrl: providerSession.uploadUrl,
        provider: providerSession.provider,
        headers: providerSession.headers,
        expiresAt: providerSession.expiresAt.toISOString()
      });
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      if (
        error instanceof MediaUploadProviderConfigurationError ||
        error instanceof MediaUploadProviderError
      ) {
        request.log.warn({ error }, "Media upload provider failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media upload provider is unavailable"
        });
      }

      throw error;
    }
  });

  app.post("/v1/media/assets/:mediaAssetId/sync", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const params = request.params as { mediaAssetId?: string };

    if (typeof params.mediaAssetId !== "string" || params.mediaAssetId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "mediaAssetId is required"
      });
    }

    try {
      if (
        !options.contentRepository.findOwnedMediaAssetForSync ||
        !options.contentRepository.updateMediaAssetPlayback ||
        !options.mediaUploadProvider.getPlaybackData
      ) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider sync is not configured"
        });
      }

      const mediaAsset = await options.contentRepository.findOwnedMediaAssetForSync({
        supabaseUserId: access.supabaseUserId,
        mediaAssetId: params.mediaAssetId
      });

      if (!mediaAsset) {
        return reply.code(404).send({
          code: "not_found",
          message: "Media asset was not found"
        });
      }

      if (!options.mediaUploadProvider.isConfigured()) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider is not configured"
        });
      }

      const playbackData = await options.mediaUploadProvider.getPlaybackData({
        providerAssetId: mediaAsset.providerAssetId
      });

      await options.contentRepository.updateMediaAssetPlayback({
        mediaAssetId: mediaAsset.id,
        ...playbackData
      });

      return reply.code(202).send();
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      if (
        error instanceof MediaUploadProviderConfigurationError ||
        error instanceof MediaUploadProviderError
      ) {
        request.log.warn({ error }, "Media provider sync failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider is unavailable"
        });
      }

      throw error;
    }
  });
}
