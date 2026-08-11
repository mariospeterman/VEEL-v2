import type { FastifyInstance } from "fastify";
import {
  isFeedMode,
  isIsoTimestamp,
  isNsfwPreference,
  isReportSubjectType,
  isShareMode,
  isShareTargetType,
  isUuid,
  repositoryReply,
  requireIdempotencyKey,
  requiredIdempotencyKey,
  toggleContentAction,
  type RegisterEngagementRoutesOptions,
  validationResponse,
  verifyEngagementAccess
} from "./engagement-route-utils.js";
import type {
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  HideFeedCreatorRequest,
  HideFeedTopicRequest,
  UpdateFeedPreferencesRequest
} from "./types.js";

export async function registerEngagementRoutes(
  app: FastifyInstance,
  options: RegisterEngagementRoutesOptions
): Promise<void> {
  app.get("/v1/feed/preferences", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.getFeedPreferences({
        supabaseUserId: access.supabaseUserId
      })
    );
  });

  app.patch("/v1/feed/preferences", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);

    const body = request.body as Partial<UpdateFeedPreferencesRequest>;
    if (
      (body.defaultMode !== undefined && !isFeedMode(body.defaultMode)) ||
      (body.nsfwPreference !== undefined && !isNsfwPreference(body.nsfwPreference))
    ) {
      return reply.code(400).send(validationResponse("Unsupported feed preference"));
    }

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.updateFeedPreferences({
        supabaseUserId: access.supabaseUserId,
        body
      })
    );
  });

  app.post("/v1/feed/reset", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    return repositoryReply(request, reply, async () => {
      await options.engagementRepository.resetFeedRecommendations({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey
      });
      return { accepted: true };
    }, 202);
  });

  app.post("/v1/feed/hide-creator", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<HideFeedCreatorRequest>;
    const creatorUserId = body.creatorUserId;
    if (!isUuid(creatorUserId)) {
      return reply.code(400).send(validationResponse("creatorUserId must be a UUID"));
    }

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.hideCreator({
        supabaseUserId: access.supabaseUserId,
        creatorUserId,
        idempotencyKey
      })
    );
  });

  app.post("/v1/feed/hide-topic", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<HideFeedTopicRequest>;
    const topic = body.topic;
    if (!topic || topic.length > 80) {
      return reply.code(400).send(validationResponse("topic is required"));
    }

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.hideTopic({
        supabaseUserId: access.supabaseUserId,
        topic,
        idempotencyKey
      })
    );
  });

  app.post("/v1/engagement/:contentId/like", async (request, reply) => {
    return toggleContentAction(request, reply, options, "like");
  });

  app.post("/v1/engagement/:contentId/save", async (request, reply) => {
    return toggleContentAction(request, reply, options, "save");
  });

  app.get("/v1/engagement/:contentId/comments", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const params = request.params as { contentId?: string };
    const query = request.query as { cursor?: string };
    const contentId = params.contentId;
    if (!isUuid(contentId)) return reply.code(400).send(validationResponse("contentId must be a UUID"));
    if (query.cursor && !isIsoTimestamp(query.cursor)) {
      return reply.code(400).send(validationResponse("cursor must be an ISO timestamp"));
    }

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.listComments({
        supabaseUserId: access.supabaseUserId,
        contentId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      })
    );
  });

  app.post("/v1/engagement/:contentId/comments", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const params = request.params as { contentId?: string };
    const body = request.body as Partial<CreateCommentRequest>;
    const contentId = params.contentId;
    const commentBody = body.body?.trim();
    if (!isUuid(contentId)) return reply.code(400).send(validationResponse("contentId must be a UUID"));
    if (!commentBody || commentBody.length > 2000) {
      return reply.code(400).send(validationResponse("comment body is required"));
    }

    return repositoryReply(
      request,
      reply,
      async () =>
        options.engagementRepository.createComment({
          supabaseUserId: access.supabaseUserId,
          contentId,
          body: { body: commentBody },
          idempotencyKey
        }),
      201
    );
  });

  app.post("/v1/shares", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const body = request.body as Partial<CreateShareRequest>;
    const targetType = body.targetType;
    const targetId = body.targetId;
    const mode = body.mode;
    if (!isShareTargetType(targetType) || !isUuid(targetId) || !isShareMode(mode)) {
      return reply.code(400).send(validationResponse("Invalid share request"));
    }

    return repositoryReply(
      request,
      reply,
      async () =>
        options.engagementRepository.createShare({
          supabaseUserId: access.supabaseUserId,
          body: {
            targetType,
            targetId,
            mode
          },
          idempotencyKey,
          webUrl: app.config.WEB_URL
        }),
      201
    );
  });

  app.post("/v1/reports", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const body = request.body as Partial<CreateReportRequest>;
    const subjectType = body.subjectType;
    const subjectId = body.subjectId;
    const reason = body.reason?.trim();
    if (
      !isReportSubjectType(subjectType) ||
      !isUuid(subjectId) ||
      !reason ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      return reply.code(400).send(validationResponse("Invalid report request"));
    }

    return repositoryReply(
      request,
      reply,
      async () =>
        options.engagementRepository.createReport({
          supabaseUserId: access.supabaseUserId,
          body: {
            subjectType,
            subjectId,
            reason
          },
          idempotencyKey
        }),
      201
    );
  });

  app.post("/v1/blocks/:userId", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const params = request.params as { userId?: string };
    const blockedUserId = params.userId;
    if (!isUuid(blockedUserId)) return reply.code(400).send(validationResponse("userId must be a UUID"));

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.blockUser({
        supabaseUserId: access.supabaseUserId,
        blockedUserId,
        idempotencyKey
      })
    );
  });
}
