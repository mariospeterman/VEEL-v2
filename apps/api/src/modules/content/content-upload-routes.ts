import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ContentImageUploadConflictError,
  ContentRepositoryConfigurationError
} from "./content-repository.js";
import { ImageValidationError, sanitizeImage } from "./image-sanitizer.js";
import {
  MediaUploadProviderConfigurationError,
  MediaUploadProviderError
} from "./media-upload-adapter.js";
import type { CreateUploadRequest } from "./types.js";
import {
  dailyQuotaWindowStart,
  imageMimeTypes,
  quotaExceededResponse,
  resolveContentCreationAbusePolicy,
  verifyCreatorCapability,
  verifyAppReadyAccess,
  videoMimeTypes,
  type RegisterContentRoutesOptions
} from "./content-route-shared.js";

export async function registerContentUploadRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  app.addContentTypeParser(
    [...imageMimeTypes],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body)
  );

  app.post(
    "/v1/content/:contentId/image-assets",
    { bodyLimit: 20 * 1024 * 1024 },
    async (request, reply) => {
      const access = await verifyAppReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);

      const idempotencyKey = request.headers["idempotency-key"];
      const params = request.params as { contentId?: string };
      const declaredMimeType = request.headers["content-type"]?.split(";", 1)[0]?.trim();

      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "Idempotency-Key header is required"
        });
      }
      if (
        typeof params.contentId !== "string" ||
        !declaredMimeType ||
        !imageMimeTypes.has(declaredMimeType) ||
        !Buffer.isBuffer(request.body)
      ) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "contentId and a supported raw image body are required"
        });
      }

      try {
        const content = await options.contentRepository.findOwnedContentForUpload({
          supabaseUserId: access.supabaseUserId,
          contentId: params.contentId
        });
        if (!content) {
          return reply.code(404).send({ code: "not_found", message: "Content draft was not found" });
        }
        if (!["image", "carousel"].includes(content.mediaType)) {
          return reply.code(409).send({
            code: "conflict",
            message: "This draft does not accept image assets"
          });
        }

        const creatorAccess = await verifyCreatorCapability(
          access.supabaseUserId,
          "canUploadMedia",
          options
        );
        if (!creatorAccess.ok) {
          return reply.code(creatorAccess.statusCode).send(creatorAccess.body);
        }

        if (options.contentRepository.countMediaAssetsCreatedSince) {
          const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
          const uploadCount = await options.contentRepository.countMediaAssetsCreatedSince({
            supabaseUserId: access.supabaseUserId,
            since: dailyQuotaWindowStart(new Date(), abusePolicy.rollingWindowHours)
          });
          if (uploadCount >= abusePolicy.dailyMediaUploadQuota) {
            return reply
              .code(429)
              .send(quotaExceededResponse("Daily media upload quota has been reached"));
          }
        }

        if (
          !options.mediaUploadProvider.isImageUploadConfigured?.() ||
          !options.mediaUploadProvider.createImageObjectReference ||
          !options.mediaUploadProvider.uploadImageObject ||
          !options.contentRepository.reserveImageAssetUpload ||
          !options.contentRepository.completeImageAssetUpload
        ) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Private image upload is not configured"
          });
        }

        const image = await sanitizeImage(request.body, declaredMimeType);
        const checksumSha256 = createHash("sha256").update(image.body).digest("hex");
        const requestHash = createHash("sha256")
          .update(JSON.stringify({
            contentId: content.id,
            checksumSha256,
            heightPixels: image.heightPixels,
            mimeType: image.mimeType,
            widthPixels: image.widthPixels
          }))
          .digest("hex");
        const mediaAssetId = randomUUID();
        const providerAssetId = options.mediaUploadProvider.createImageObjectReference({
          contentId: content.id,
          mediaAssetId,
          extension: image.extension
        });
        const reservation = await options.contentRepository.reserveImageAssetUpload({
          supabaseUserId: access.supabaseUserId,
          contentId: content.id,
          mediaAssetId,
          idempotencyKey,
          requestHash,
          providerAssetId,
          mimeType: image.mimeType,
          widthPixels: image.widthPixels,
          heightPixels: image.heightPixels,
          checksumSha256
        });

        if (!reservation.completed) {
          await options.mediaUploadProvider.uploadImageObject({
            providerAssetId: reservation.providerAssetId,
            body: image.body,
            mimeType: image.mimeType,
            checksumSha256
          });
          await options.contentRepository.completeImageAssetUpload({
            mediaAssetId: reservation.mediaAssetId,
            providerAssetId: reservation.providerAssetId
          });
        }

        return reply.code(201).send({
          mediaAssetId: reservation.mediaAssetId,
          kind: "image",
          mimeType: image.mimeType,
          widthPixels: image.widthPixels,
          heightPixels: image.heightPixels,
          releaseState: "awaiting_safety_evidence"
        });
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return reply.code(400).send({ code: "validation_failed", message: error.message });
        }
        if (error instanceof ContentImageUploadConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message:
              error.reason === "idempotency_conflict"
                ? "Idempotency-Key was already used for a different image"
                : "The image draft changed; refresh it before retrying"
          });
        }
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
          request.log.warn({ error }, "Private image upload failed");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Private image upload is unavailable"
          });
        }
        throw error;
      }
    }
  );

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

      const creatorAccess = await verifyCreatorCapability(
        access.supabaseUserId,
        "canUploadMedia",
        options
      );

      if (!creatorAccess.ok) {
        return reply.code(creatorAccess.statusCode).send(creatorAccess.body);
      }

      if (options.contentRepository.countMediaAssetsCreatedSince) {
        const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
        const uploadCount = await options.contentRepository.countMediaAssetsCreatedSince({
          supabaseUserId: access.supabaseUserId,
          since: dailyQuotaWindowStart(new Date(), abusePolicy.rollingWindowHours)
        });

        if (uploadCount >= abusePolicy.dailyMediaUploadQuota) {
          return reply
            .code(429)
            .send(quotaExceededResponse("Daily media upload quota has been reached"));
        }
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

      const mediaAsset = await options.contentRepository.createMediaAsset({
        contentId: content.id,
        provider: providerSession.provider,
        providerAssetId: providerSession.providerAssetId,
        providerState: "created"
      });

      if (!mediaAsset?.id) {
        request.log.warn("Media asset record was not created for upload session");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media upload session was not persisted"
        });
      }

      return reply.code(201).send({
        uploadUrl: providerSession.uploadUrl,
        provider: providerSession.provider,
        mediaAssetId: mediaAsset.id,
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

  app.patch("/v1/media/assets/:mediaAssetId", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = request.headers["idempotency-key"];
    const params = request.params as { mediaAssetId?: string };
    const body = request.body as {
      expectedCompositionRevision?: unknown;
      altText?: unknown;
      originClassification?: unknown;
    } | undefined;
    const origins = new Set([
      "human_created",
      "ai_assisted",
      "ai_generated",
      "materially_ai_manipulated"
    ]);
    const altTextProvided = Boolean(body && Object.hasOwn(body, "altText"));
    const originProvided = Boolean(body && Object.hasOwn(body, "originClassification"));
    if (
      typeof idempotencyKey !== "string" ||
      !params.mediaAssetId ||
      !body ||
      !Number.isInteger(body.expectedCompositionRevision) ||
      Number(body.expectedCompositionRevision) < 1 ||
      (!altTextProvided && !originProvided) ||
      (altTextProvided && body.altText !== null && typeof body.altText !== "string") ||
      (originProvided &&
        (typeof body.originClassification !== "string" ||
          !origins.has(body.originClassification)))
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "A composition revision and supported asset changes are required"
      });
    }
    const altText = typeof body.altText === "string" ? body.altText.trim() || null : null;
    if (altText && altText.length > 1_000) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Alt text must be 1,000 characters or fewer"
      });
    }
    if (!options.contentRepository.updateOwnedMediaAsset) {
      return reply.code(503).send({ code: "service_unavailable", message: "Asset editing is unavailable" });
    }

    try {
      const normalized = {
        expectedCompositionRevision: Number(body.expectedCompositionRevision),
        ...(altTextProvided ? { altText } : {}),
        ...(originProvided ? { originClassification: body.originClassification as string } : {})
      };
      const result = await options.contentRepository.updateOwnedMediaAsset({
        supabaseUserId: access.supabaseUserId,
        mediaAssetId: params.mediaAssetId,
        idempotencyKey,
        requestHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
        expectedCompositionRevision: normalized.expectedCompositionRevision,
        altText,
        altTextProvided,
        ...(originProvided
          ? {
              originClassification: body.originClassification as
                | "human_created"
                | "ai_assisted"
                | "ai_generated"
                | "materially_ai_manipulated"
            }
          : {})
      });
      if (!result) {
        return reply.code(404).send({ code: "not_found", message: "Editable media asset was not found" });
      }
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof ContentImageUploadConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message:
            error.reason === "idempotency_conflict"
              ? "Idempotency-Key was already used for different asset changes"
              : "The draft changed; refresh it before editing this asset"
        });
      }
      if (error instanceof ContentRepositoryConfigurationError) {
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
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
        !options.contentRepository.captureProviderObservationCutoff ||
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

      const providerObservationCutoff =
        await options.contentRepository.captureProviderObservationCutoff();
      const playbackData = await options.mediaUploadProvider.getPlaybackData({
        providerAssetId: mediaAsset.providerAssetId
      });

      await options.contentRepository.updateMediaAssetPlayback({
        mediaAssetId: mediaAsset.id,
        providerObservationCutoff,
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
