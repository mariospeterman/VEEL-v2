import type { FastifyInstance } from "fastify";
import {
  ContentDraftIdempotencyConflictError,
  ContentDraftQuotaExceededError,
  ContentEventDraftConflictError,
  ContentModerationAppealConflictError,
  ContentPublishConflictError,
  ContentRepositoryConfigurationError
} from "./content-repository.js";
import { hashIdempotencyPayload, readIdempotencyKey } from "../../shared/idempotency.js";
import { validateEventDraft } from "../event/event-route-shared.js";
import type {
  CreateContentRequest,
  CreateMediaModerationAppealRequest,
  PublishContentRequest,
  UpdateContentRequest
} from "./types.js";
import {
  contentMediaTypes,
  contentVisibilityValues,
  dailyQuotaWindowStart,
  feedModeFromQuery,
  nsfwLabels,
  quotaExceededResponse,
  representationModes,
  resolveContentCreationAbusePolicy,
  verifyCreatorCapability,
  verifyAppReadyAccess,
  withSignedPlayback,
  type RegisterContentRoutesOptions
} from "./content-route-shared.js";

export async function registerContentCoreRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  app.post("/v1/content", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<CreateContentRequest> | undefined;

    if (
      !body ||
      typeof body.mediaType !== "string" ||
      !contentMediaTypes.has(body.mediaType) ||
      typeof body.visibility !== "string" ||
      !contentVisibilityValues.has(body.visibility) ||
      typeof body.nsfwLabel !== "string" ||
      !nsfwLabels.has(body.nsfwLabel)
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "mediaType, visibility, and nsfwLabel are required"
      });
    }

    try {
      const isAdultRated = body.nsfwLabel !== "none";
      if (
        (typeof body.representationMode !== "string" ||
          !representationModes.has(body.representationMode) ||
          body.contentSafetyPolicyAccepted !== true)
      ) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "A people-and-rights declaration and policy acceptance are required"
        });
      }

      if (isAdultRated) {
        const creatorAccess = await verifyCreatorCapability(
          access.supabaseUserId,
          "canPublishAdultMedia",
          options
        );
        if (!creatorAccess.ok) {
          return reply.code(creatorAccess.statusCode).send(creatorAccess.body);
        }
      }

      const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
      const draftBody = {
        mediaType: body.mediaType,
        caption: typeof body.caption === "string" ? body.caption : null,
        visibility: body.visibility,
        nsfwLabel: body.nsfwLabel,
        representationMode: body.representationMode as NonNullable<CreateContentRequest["representationMode"]>,
        contentSafetyPolicyAccepted: true
      };

      const content = await options.contentRepository.createDraft({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashIdempotencyPayload(draftBody),
        ...draftBody,
        quotaWindowStart: dailyQuotaWindowStart(new Date(), abusePolicy.rollingWindowHours),
        dailyDraftQuota: abusePolicy.dailyContentDraftQuota
      });

      return reply.code(201).send(content);
    } catch (error) {
      if (error instanceof ContentDraftIdempotencyConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Idempotency key was already used for a different content draft"
        });
      }

      if (error instanceof ContentDraftQuotaExceededError) {
        return reply
          .code(429)
          .send(quotaExceededResponse("Daily content draft quota has been reached"));
      }

      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/content/mine", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { cursor?: string };
    if (query.cursor && Number.isNaN(Date.parse(query.cursor))) {
      return reply.code(400).send({ code: "validation_failed", message: "cursor must be an ISO date-time" });
    }

    try {
      if (!options.contentRepository.listOwnedContent) {
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      return reply.code(200).send(await options.contentRepository.listOwnedContent({
        supabaseUserId: access.supabaseUserId,
        limit: 24,
        ...(query.cursor ? { cursor: query.cursor } : {})
      }));
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      throw error;
    }
  });

  app.get("/v1/content/feed", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { mode?: string; cursor?: string };
    const mode = feedModeFromQuery(query.mode);

    try {
      const feedInput = {
        supabaseUserId: access.supabaseUserId,
        mode,
        limit: 20
      };

      const feed = await options.contentRepository.listHomeFeed(
        query.cursor ? { ...feedInput, cursor: query.cursor } : feedInput
      );

      return reply.code(200).send(feed);
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(200).send({
          items: [],
          nextCursor: null
        });
      }

      throw error;
    }
  });

  app.get("/v1/content/:contentId", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const params = request.params as { contentId?: string };

    if (typeof params.contentId !== "string" || params.contentId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId is required"
      });
    }

    try {
      const content = await options.contentRepository.findContentDetail({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content was not found"
        });
      }

      return reply.code(200).send(await withSignedPlayback({
        content,
        mediaUploadProvider: options.mediaUploadProvider,
        subscriptionRepository: options.subscriptionRepository,
        supabaseUserId: access.supabaseUserId,
        appUserId: access.appUserId
      }));
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.patch("/v1/content/:contentId", async (request, reply) => {
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

    const params = request.params as { contentId?: string };

    if (typeof params.contentId !== "string" || params.contentId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId is required"
      });
    }

    const body = request.body as Partial<UpdateContentRequest> | undefined;
    const validationError = validateUpdateContentBody(body);

    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    try {
      if (!options.contentRepository.updateOwnedContent) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      let currentContent = null;
      if (body?.representationMode && body.nsfwLabel === undefined) {
        if (!options.contentRepository.findOwnedContentForUpdate) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Content storage is not configured"
          });
        }
        currentContent = await options.contentRepository.findOwnedContentForUpdate({
          supabaseUserId: access.supabaseUserId,
          contentId: params.contentId
        });
        if (!currentContent) {
          return reply.code(404).send({
            code: "not_found",
            message: "Content was not found"
          });
        }
      }
      const adultDeclaration =
        (body?.nsfwLabel !== undefined && body.nsfwLabel !== "none") ||
        (body?.representationMode !== undefined && currentContent?.nsfwLabel !== "none");
      if (adultDeclaration) {
        const creatorAccess = await verifyCreatorCapability(
          access.supabaseUserId,
          "canPublishAdultMedia",
          options
        );
        if (!creatorAccess.ok) {
          return reply.code(creatorAccess.statusCode).send(creatorAccess.body);
        }
      }

      const content = await options.contentRepository.updateOwnedContent({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId,
        idempotencyKey,
        caption: body && "caption" in body ? body.caption ?? null : undefined,
        captionProvided: Boolean(body && "caption" in body),
        visibility: body?.visibility,
        nsfwLabel: body?.nsfwLabel,
        representationMode: body?.representationMode,
        contentSafetyPolicyAccepted: body?.contentSafetyPolicyAccepted === true,
        teaserStartMs: body && "teaserStartMs" in body ? body.teaserStartMs ?? null : undefined,
        teaserStartMsProvided: Boolean(body && "teaserStartMs" in body),
        teaserEndMs: body && "teaserEndMs" in body ? body.teaserEndMs ?? null : undefined,
        teaserEndMsProvided: Boolean(body && "teaserEndMs" in body),
        thumbnailFrameMs:
          body && "thumbnailFrameMs" in body ? body.thumbnailFrameMs ?? null : undefined,
        thumbnailFrameMsProvided: Boolean(body && "thumbnailFrameMs" in body),
        eventDraft: body?.eventDraft,
        eventDraftProvided: Boolean(body && "eventDraft" in body)
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content was not found"
        });
      }

      return reply.code(200).send(content);
    } catch (error) {
      if (error instanceof ContentEventDraftConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Linked Event Access draft is no longer editable"
        });
      }

      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/content/:contentId/publish", async (request, reply) => {
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

    const params = request.params as { contentId?: string };

    if (typeof params.contentId !== "string" || params.contentId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId is required"
      });
    }

    const body = request.body as Partial<PublishContentRequest> | undefined;

    if (!body || body.confirmation !== "submit_for_review") {
      return reply.code(400).send({
        code: "validation_failed",
        message: "confirmation must be submit_for_review"
      });
    }

    try {
      const ownedContent = await options.contentRepository.findOwnedContentForUpload({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId
      });

      if (!ownedContent) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content draft was not found"
        });
      }

      const creatorAccess = await verifyCreatorCapability(
        access.supabaseUserId,
        ownedContent.nsfwLabel === "none" ? "canPublishMedia" : "canPublishAdultMedia",
        options
      );

      if (!creatorAccess.ok) {
        return reply.code(creatorAccess.statusCode).send(creatorAccess.body);
      }

      if (!options.contentRepository.publishOwnedContent) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      const content = await options.contentRepository.publishOwnedContent({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId,
        idempotencyKey
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content was not found"
        });
      }

      return reply.code(200).send(content);
    } catch (error) {
      if (error instanceof ContentPublishConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message:
            error.reason === "blocked"
              ? "Content is blocked and cannot be published"
              : "Content cannot be published until provider media is ready"
        });
      }

      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/content/:contentId/moderation-appeals", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = readIdempotencyKey(request);
    const { contentId } = request.params as { contentId?: string };
    const body = request.body as Partial<CreateMediaModerationAppealRequest> | undefined;

    if (!idempotencyKey) {
      return reply.code(400).send({ code: "validation_failed", message: "Idempotency-Key header is required" });
    }
    if (!contentId) {
      return reply.code(400).send({ code: "validation_failed", message: "contentId is required" });
    }
    if (!body || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 2000) {
      return reply.code(400).send({ code: "validation_failed", message: "Appeal reason must be between 3 and 2000 characters" });
    }

    try {
      if (!options.contentRepository.createModerationAppeal) {
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      const appeal = await options.contentRepository.createModerationAppeal({
        supabaseUserId: access.supabaseUserId,
        contentId,
        idempotencyKey,
        reason: body.reason.trim()
      });
      if (!appeal) {
        return reply.code(404).send({ code: "not_found", message: "Content was not found" });
      }
      return reply.code(201).send(appeal);
    } catch (error) {
      if (error instanceof ContentModerationAppealConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: error.reason === "appeal_already_open"
            ? "An appeal is already being reviewed"
            : error.reason === "idempotency_conflict"
              ? "Idempotency key was already used for a different appeal"
              : "This review decision cannot be appealed"
        });
      }
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      throw error;
    }
  });
}

function validateUpdateContentBody(body: Partial<UpdateContentRequest> | undefined): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Update body is required";
  }

  const hasKnownField =
    "caption" in body ||
    "visibility" in body ||
    "nsfwLabel" in body ||
    "representationMode" in body ||
    "contentSafetyPolicyAccepted" in body ||
    "teaserStartMs" in body ||
    "teaserEndMs" in body ||
    "thumbnailFrameMs" in body ||
    "eventDraft" in body;

  if (!hasKnownField) {
    return "At least one content update field is required";
  }

  if ("eventDraft" in body) {
    const eventDraftError = validateEventDraft(body.eventDraft);
    if (eventDraftError) {
      return eventDraftError;
    }
  }

  if ("caption" in body && typeof body.caption !== "string") {
    return "caption must be a string";
  }

  if (typeof body.caption === "string" && body.caption.length > 2_200) {
    return "caption must be 2200 characters or fewer";
  }

  if ("visibility" in body && !contentVisibilityValues.has(body.visibility ?? "")) {
    return "visibility is invalid";
  }

  if ("nsfwLabel" in body && !nsfwLabels.has(body.nsfwLabel ?? "")) {
    return "nsfwLabel is invalid";
  }

  if (
    "representationMode" in body &&
    !representationModes.has(body.representationMode ?? "")
  ) {
    return "representationMode is invalid";
  }

  if (
    "representationMode" in body &&
    body.contentSafetyPolicyAccepted !== true
  ) {
    return "Changing a performer declaration requires policy acceptance";
  }

  if (
    body.nsfwLabel &&
    body.nsfwLabel !== "none" &&
    (!body.representationMode || body.contentSafetyPolicyAccepted !== true)
  ) {
    return "Adult or explicit media requires a performer declaration and policy acceptance";
  }

  for (const [field, value] of [
    ["teaserStartMs", body.teaserStartMs],
    ["teaserEndMs", body.teaserEndMs],
    ["thumbnailFrameMs", body.thumbnailFrameMs]
  ] as const) {
    if (
      field in body &&
      value !== null &&
      (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    ) {
      return `${field} must be a non-negative integer or null`;
    }
  }

  if (
    typeof body.teaserStartMs === "number" &&
    typeof body.teaserEndMs === "number" &&
    body.teaserEndMs < body.teaserStartMs
  ) {
    return "teaserEndMs must be greater than or equal to teaserStartMs";
  }

  return null;
}
