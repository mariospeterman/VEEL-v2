import type { FastifyInstance } from "fastify";
import {
  ContentEventDraftConflictError,
  ContentPublishConflictError,
  ContentRepositoryConfigurationError
} from "./content-repository.js";
import { validateEventDraft } from "../event/event-route-shared.js";
import type {
  CreateContentRequest,
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

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
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
      if (options.contentRepository.countContentDraftsCreatedSince) {
        const abusePolicy = await resolveContentCreationAbusePolicy(options.contentRepository);
        const draftCount = await options.contentRepository.countContentDraftsCreatedSince({
          supabaseUserId: access.supabaseUserId,
          since: dailyQuotaWindowStart(new Date(), abusePolicy.rollingWindowHours)
        });

        if (draftCount >= abusePolicy.dailyContentDraftQuota) {
          return reply
            .code(429)
            .send(quotaExceededResponse("Daily content draft quota has been reached"));
        }
      }

      const content = await options.contentRepository.createDraft({
        supabaseUserId: access.supabaseUserId,
        mediaType: body.mediaType,
        caption: typeof body.caption === "string" ? body.caption : null,
        visibility: body.visibility,
        nsfwLabel: body.nsfwLabel
      });

      return reply.code(201).send(content);
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

      return reply.code(200).send(withSignedPlayback(content, options.mediaUploadProvider));
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

      const content = await options.contentRepository.updateOwnedContent({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId,
        idempotencyKey,
        caption: body && "caption" in body ? body.caption ?? null : undefined,
        captionProvided: Boolean(body && "caption" in body),
        visibility: body?.visibility,
        nsfwLabel: body?.nsfwLabel,
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
      const creatorAccess = await verifyCreatorCapability(
        access.supabaseUserId,
        "canPublishMedia",
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
}

function validateUpdateContentBody(body: Partial<UpdateContentRequest> | undefined): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Update body is required";
  }

  const hasKnownField =
    "caption" in body ||
    "visibility" in body ||
    "nsfwLabel" in body ||
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
