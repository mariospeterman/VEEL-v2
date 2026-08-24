import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
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
  CreateDataRequestRequest,
  CreateReportRequest,
  CreateShareRequest,
  HideFeedCreatorRequest,
  HideFeedTopicRequest,
  RecordFeedImpressionRequest,
  UpdateFeedPreferencesRequest
} from "./types.js";

export async function registerEngagementRoutes(
  app: FastifyInstance,
  options: RegisterEngagementRoutesOptions
): Promise<void> {
  app.get(
    "/v1/follows/:userId",
    { schema: contractRouteSchema("getFollowState") },
    async (request, reply) => {
      const access = await verifyEngagementAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const targetUserId = (request.params as { userId?: string }).userId;
      if (!isUuid(targetUserId)) {
        return reply.code(400).send(validationResponse("userId must be a UUID"));
      }
      return repositoryReply(request, reply, () =>
        options.engagementRepository.getFollowState({
          supabaseUserId: access.supabaseUserId,
          targetUserId
        })
      );
    }
  );

  const setFollow = async (
    request: FastifyRequest,
    reply: FastifyReply,
    following: boolean
  ) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const targetUserId = (request.params as { userId?: string }).userId;
    if (!isUuid(targetUserId)) {
      return reply.code(400).send(validationResponse("userId must be a UUID"));
    }
    return repositoryReply(request, reply, () =>
      options.engagementRepository.setFollowState({
        supabaseUserId: access.supabaseUserId,
        targetUserId,
        following,
        idempotencyKey
      })
    );
  };

  app.post(
    "/v1/follows/:userId",
    mutationRateLimit("socialMutation", "followUser"),
    async (request, reply) => setFollow(request, reply, true)
  );

  app.delete(
    "/v1/follows/:userId",
    mutationRateLimit("socialMutation", "unfollowUser"),
    async (request, reply) => setFollow(request, reply, false)
  );

  app.post(
    "/v1/feed/impressions",
    mutationRateLimit("socialMutation", "recordFeedImpression"),
    async (request, reply) => {
      const access = await verifyEngagementAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }
      const contentId = (request.body as Partial<RecordFeedImpressionRequest>)?.contentId;
      if (!isUuid(contentId)) {
        return reply.code(400).send(validationResponse("contentId must be a UUID"));
      }
      return repositoryReply(request, reply, async () => {
        await options.engagementRepository.recordFeedImpression({
          supabaseUserId: access.supabaseUserId,
          body: { contentId },
          idempotencyKey
        });
        return { accepted: true };
      }, 202);
    }
  );

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

  app.post("/v1/engagement/:contentId/like", mutationRateLimit("socialMutation", "toggleContentLike"), async (request, reply) => {
    return toggleContentAction(request, reply, options, "like");
  });

  app.post("/v1/engagement/:contentId/save", mutationRateLimit("socialMutation", "toggleContentSave"), async (request, reply) => {
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

  app.post("/v1/engagement/:contentId/comments", mutationRateLimit("socialMutation", "createContentComment"), async (request, reply) => {
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
    if (body.parentCommentId !== undefined && body.parentCommentId !== null && !isUuid(body.parentCommentId)) {
      return reply.code(400).send(validationResponse("parentCommentId must be a UUID"));
    }

    return repositoryReply(
      request,
      reply,
      async () =>
        options.engagementRepository.createComment({
          supabaseUserId: access.supabaseUserId,
          contentId,
          body: {
            body: commentBody,
            ...(body.parentCommentId ? { parentCommentId: body.parentCommentId } : {})
          },
          idempotencyKey
        }),
      201
    );
  });

  app.post(
    "/v1/engagement/comments/:commentId/like",
    mutationRateLimit("socialMutation", "toggleCommentLike"),
    async (request, reply) => {
      const access = await verifyEngagementAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }
      const commentId = (request.params as { commentId?: string }).commentId;
      if (!isUuid(commentId)) return reply.code(400).send(validationResponse("commentId must be a UUID"));
      return repositoryReply(request, reply, () => options.engagementRepository.toggleCommentLike({
        supabaseUserId: access.supabaseUserId,
        commentId,
        idempotencyKey
      }));
    }
  );

  app.post("/v1/shares", mutationRateLimit("socialMutation", "createShare"), async (request, reply) => {
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

  app.post("/v1/reports", mutationRateLimit("socialMutation", "createReport"), async (request, reply) => {
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

  app.post("/v1/blocks/:userId", mutationRateLimit("socialMutation", "blockUser"), async (request, reply) => {
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

  app.delete("/v1/blocks/:userId", mutationRateLimit("socialMutation", "unblockUser"), async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    const blockedUserId = (request.params as { userId?: string }).userId;
    if (!idempotencyKey) return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    if (!isUuid(blockedUserId)) return reply.code(400).send(validationResponse("userId must be a UUID"));
    return repositoryReply(request, reply, () => options.engagementRepository.unblockUser({
      supabaseUserId: access.supabaseUserId,
      blockedUserId,
      idempotencyKey
    }));
  });

  const setMute = async (request: FastifyRequest, reply: FastifyReply, muted: boolean) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    const mutedUserId = (request.params as { userId?: string }).userId;
    if (!idempotencyKey) return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    if (!isUuid(mutedUserId)) return reply.code(400).send(validationResponse("userId must be a UUID"));
    return repositoryReply(request, reply, () => options.engagementRepository.setMute({
      supabaseUserId: access.supabaseUserId,
      mutedUserId,
      muted,
      idempotencyKey
    }));
  };

  app.post("/v1/mutes/:userId", mutationRateLimit("socialMutation", "muteUser"), async (request, reply) =>
    setMute(request, reply, true));
  app.delete("/v1/mutes/:userId", mutationRateLimit("socialMutation", "unmuteUser"), async (request, reply) =>
    setMute(request, reply, false));

  app.get("/v1/privacy", async (request, reply) => {
    const access = await verifyEngagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    return repositoryReply(request, reply, () => options.engagementRepository.getPrivacySettings({
      supabaseUserId: access.supabaseUserId
    }));
  });

  app.post(
    "/v1/privacy/data-requests",
    mutationRateLimit("socialMutation", "createDataRequest"),
    async (request, reply) => {
      const access = await verifyEngagementAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      const body = request.body as Partial<CreateDataRequestRequest>;
      const reason = body.reason?.trim();
      const requestType = body.type;
      if (requestType !== "export" && requestType !== "delete") {
        return reply.code(400).send(validationResponse("type must be export or delete"));
      }
      if (reason !== undefined && (reason.length < 3 || reason.length > 500)) {
        return reply.code(400).send(validationResponse("reason must be between 3 and 500 characters"));
      }
      return repositoryReply(request, reply, () => options.engagementRepository.createDataRequest({
        supabaseUserId: access.supabaseUserId,
        body: { type: requestType, ...(reason ? { reason } : {}) },
        idempotencyKey
      }), 201);
    }
  );
}
