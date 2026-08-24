import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ContentAssetRetirementConflictError,
  ContentImageUploadConflictError,
  ContentRepositoryConfigurationError,
  McpMediaCapabilityConflictError
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

        const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
        const quotaWindowStart = dailyQuotaWindowStart(
          new Date(),
          abusePolicy.rollingWindowHours
        );
        if (options.contentRepository.countMediaAssetsCreatedSince) {
          const uploadCount = await options.contentRepository.countMediaAssetsCreatedSince({
            supabaseUserId: access.supabaseUserId,
            since: quotaWindowStart
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
          checksumSha256,
          quotaWindowStart,
          dailyMediaUploadQuota: abusePolicy.dailyMediaUploadQuota
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
          if (error.reason === "quota_exceeded") {
            return reply
              .code(429)
              .send(quotaExceededResponse("Daily media upload quota has been reached"));
          }
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

    let unattachedVideoProviderAssetId: string | null = null;
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
      if (!["bit", "clip", "vod", "live_replay", "carousel"].includes(content.mediaType)) {
        return reply.code(409).send({
          code: "conflict",
          message: "This draft does not accept video assets"
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

      const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
      const quotaWindowStart = dailyQuotaWindowStart(
        new Date(),
        abusePolicy.rollingWindowHours
      );
      if (options.contentRepository.countMediaAssetsCreatedSince) {
        const uploadCount = await options.contentRepository.countMediaAssetsCreatedSince({
          supabaseUserId: access.supabaseUserId,
          since: quotaWindowStart
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
      unattachedVideoProviderAssetId = providerSession.providerAssetId;

      const mediaAsset = await options.contentRepository.createMediaAsset({
        supabaseUserId: access.supabaseUserId,
        contentId: content.id,
        provider: providerSession.provider,
        providerAssetId: providerSession.providerAssetId,
        providerState: "created",
        quotaWindowStart,
        dailyMediaUploadQuota: abusePolicy.dailyMediaUploadQuota
      });

      if (!mediaAsset?.id) {
        throw new MediaUploadProviderError();
      }
      unattachedVideoProviderAssetId = null;

      return reply.code(201).send({
        uploadUrl: providerSession.uploadUrl,
        provider: providerSession.provider,
        mediaAssetId: mediaAsset.id,
        headers: providerSession.headers,
        expiresAt: providerSession.expiresAt.toISOString()
      });
    } catch (error) {
      if (unattachedVideoProviderAssetId) {
        let providerDeleted = false;
        try {
          if (options.mediaUploadProvider.deleteProviderAsset) {
            await options.mediaUploadProvider.deleteProviderAsset({
              providerAssetId: unattachedVideoProviderAssetId,
              assetKind: "video"
            });
            providerDeleted = true;
          }
        } catch (cleanupError) {
          request.log.warn(
            { cleanupError },
            "Unattached private video requires provider cleanup"
          );
        }
        if (!providerDeleted) {
          if (!options.contentRepository.scheduleUnattachedMediaProviderCleanup) {
            return reply.code(503).send({
              code: "service_unavailable",
              message: "Media cleanup recovery is unavailable"
            });
          }
          await options.contentRepository.scheduleUnattachedMediaProviderCleanup({
            supabaseUserId: access.supabaseUserId,
            contentId: (request.body as Partial<CreateUploadRequest>).contentId!,
            provider: "bunny",
            providerAssetId: unattachedVideoProviderAssetId,
            assetKind: "video",
            failureCode: "provider_delete_failed"
          });
        }
      }
      if (error instanceof ContentImageUploadConflictError) {
        if (error.reason === "quota_exceeded") {
          return reply
            .code(429)
            .send(quotaExceededResponse("Daily media upload quota has been reached"));
        }
        return reply.code(409).send({
          code: "conflict",
          message: "The media draft changed; refresh it before retrying"
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
      !uuidPattern.test(params.mediaAssetId) ||
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
              : error.reason === "provenance_locked"
                ? "Assistant-origin media cannot be relabeled as human-created"
              : "The draft changed; refresh it before editing this asset"
        });
      }
      if (error instanceof ContentRepositoryConfigurationError) {
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      throw error;
    }
  });

  app.post("/v1/media/assets/:mediaAssetId/provenance-review", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = request.headers["idempotency-key"];
    const params = request.params as { mediaAssetId?: string };
    const body = request.body as {
      expectedCompositionRevision?: unknown;
      decision?: unknown;
    } | undefined;
    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 12 ||
      idempotencyKey.length > 128 ||
      !params.mediaAssetId ||
      !uuidPattern.test(params.mediaAssetId) ||
      !body ||
      !Number.isInteger(body.expectedCompositionRevision) ||
      Number(body.expectedCompositionRevision) < 1 ||
      (body.decision !== "confirmed" && body.decision !== "rejected")
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "A composition revision and confirmed or rejected decision are required"
      });
    }
    if (!options.contentRepository.reviewOwnedMediaAssetProvenance) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Provenance review is unavailable"
      });
    }

    const normalized = {
      expectedCompositionRevision: Number(body.expectedCompositionRevision),
      decision: body.decision
    } as const;
    try {
      const result = await options.contentRepository.reviewOwnedMediaAssetProvenance({
        supabaseUserId: access.supabaseUserId,
        mediaAssetId: params.mediaAssetId,
        idempotencyKey,
        requestHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
        ...normalized
      });
      if (!result) {
        return reply.code(404).send({
          code: "not_found",
          message: "Reviewable provenance claim was not found"
        });
      }
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof McpMediaCapabilityConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: error.reason === "idempotency_conflict"
            ? "Idempotency-Key was already used for a different provenance review"
            : "The draft changed or this provenance claim was already decided"
        });
      }
      if (error instanceof ContentRepositoryConfigurationError) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Provenance review is unavailable"
        });
      }
      throw error;
    }
  });

  app.delete("/v1/media/assets/:mediaAssetId", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = request.headers["idempotency-key"];
    const params = request.params as { mediaAssetId?: string };
    const body = request.body as {
      expectedCompositionRevision?: unknown;
      reason?: unknown;
    } | undefined;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (
      typeof idempotencyKey !== "string" ||
      !params.mediaAssetId ||
      !body ||
      !Number.isInteger(body.expectedCompositionRevision) ||
      Number(body.expectedCompositionRevision) < 1 ||
      !reason ||
      reason.length > 240
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "A composition revision, idempotency key, and removal reason are required"
      });
    }
    if (
      !options.contentRepository.retireOwnedMediaAsset ||
      !options.contentRepository.completeMediaAssetCleanup
    ) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Asset removal is unavailable"
      });
    }

    try {
      const normalized = {
        expectedCompositionRevision: Number(body.expectedCompositionRevision),
        reason
      };
      const retired = await options.contentRepository.retireOwnedMediaAsset({
        supabaseUserId: access.supabaseUserId,
        mediaAssetId: params.mediaAssetId,
        idempotencyKey,
        requestHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
        expectedCompositionRevision: normalized.expectedCompositionRevision,
        reason
      });
      if (!retired) {
        return reply.code(404).send({ code: "not_found", message: "Editable media asset was not found" });
      }

      let cleanupState = retired.cleanupState;
      if (cleanupState !== "completed") {
        try {
          if (
            retired.provider !== options.mediaUploadProvider.provider ||
            !options.mediaUploadProvider.deleteProviderAsset
          ) {
            throw new MediaUploadProviderConfigurationError();
          }
          await options.mediaUploadProvider.deleteProviderAsset({
            providerAssetId: retired.providerAssetId,
            assetKind: retired.assetKind
          });
          await options.contentRepository.completeMediaAssetCleanup({
            supabaseUserId: access.supabaseUserId,
            mediaAssetId: retired.mediaAssetId,
            idempotencyKey,
            succeeded: true
          });
          cleanupState = "completed";
        } catch (error) {
          const errorCode = error instanceof MediaUploadProviderConfigurationError
            ? "provider_delete_not_configured"
            : "provider_delete_failed";
          await options.contentRepository.completeMediaAssetCleanup({
            supabaseUserId: access.supabaseUserId,
            mediaAssetId: retired.mediaAssetId,
            idempotencyKey,
            succeeded: false,
            errorCode
          });
          request.log.warn({ error, mediaAssetId: retired.mediaAssetId }, "Retired media cleanup is pending retry");
          cleanupState = "retry";
        }
      }

      return reply.code(cleanupState === "completed" ? 200 : 202).send({
        mediaAssetId: retired.mediaAssetId,
        compositionRevision: retired.compositionRevision,
        cleanupState
      });
    } catch (error) {
      if (error instanceof ContentAssetRetirementConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: error.reason === "idempotency_conflict"
            ? "Idempotency-Key was already used for a different removal"
            : error.reason === "revision_conflict"
              ? "The draft changed; refresh it before removing this asset"
              : "This asset can no longer be removed from the draft"
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
