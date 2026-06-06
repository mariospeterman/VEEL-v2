import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import { EngagementPolicyError, EngagementRepositoryConfigurationError } from "./engagement-repository.js";
import type {
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  EngagementRepository,
  HideFeedCreatorRequest,
  HideFeedTopicRequest,
  UpdateFeedPreferencesRequest
} from "./types.js";

interface RegisterEngagementRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  engagementRepository: EngagementRepository;
}

const feedModes = new Set(["recommended", "following", "nsfw", "sfw"]);
const nsfwPreferences = new Set(["recommended", "nsfw", "sfw"]);
const shareModes = new Set(["internal_message", "external_referral_link", "copy_link"]);
const shareTargetTypes = new Set(["content", "profile", "event"]);
const reportSubjectTypes = new Set(["content", "user", "message", "live_room", "event"]);

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

    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<HideFeedCreatorRequest>;
    const creatorUserId = body.creatorUserId;
    if (!creatorUserId) return reply.code(400).send(validationResponse("creatorUserId is required"));

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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
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
    if (!contentId) return reply.code(400).send(validationResponse("contentId is required"));

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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const params = request.params as { contentId?: string };
    const body = request.body as Partial<CreateCommentRequest>;
    const contentId = params.contentId;
    const commentBody = body.body;
    if (!contentId) return reply.code(400).send(validationResponse("contentId is required"));
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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const body = request.body as Partial<CreateShareRequest>;
    const targetType = body.targetType;
    const targetId = body.targetId;
    const mode = body.mode;
    if (!isShareTargetType(targetType) || !targetId || !isShareMode(mode)) {
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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const body = request.body as Partial<CreateReportRequest>;
    const subjectType = body.subjectType;
    const subjectId = body.subjectId;
    const reason = body.reason;
    if (
      !isReportSubjectType(subjectType) ||
      !subjectId ||
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
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const params = request.params as { userId?: string };
    const blockedUserId = params.userId;
    if (!blockedUserId) return reply.code(400).send(validationResponse("userId is required"));

    return repositoryReply(request, reply, async () =>
      options.engagementRepository.blockUser({
        supabaseUserId: access.supabaseUserId,
        blockedUserId,
        idempotencyKey
      })
    );
  });
}

async function toggleContentAction(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterEngagementRoutesOptions,
  action: "like" | "save"
) {
  const access = await verifyEngagementAccess(request, options);
  if (!access.ok) return reply.code(access.statusCode).send(access.body);
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
  }
  const params = request.params as { contentId?: string };
  const contentId = params.contentId;
  if (!contentId) return reply.code(400).send(validationResponse("contentId is required"));

  return repositoryReply(request, reply, async () =>
    action === "like"
      ? options.engagementRepository.toggleLike({
          supabaseUserId: access.supabaseUserId,
          contentId,
          idempotencyKey
        })
      : options.engagementRepository.toggleSave({
          supabaseUserId: access.supabaseUserId,
          contentId,
          idempotencyKey
        })
  );
}

type EngagementAccessResult =
  | { ok: true; supabaseUserId: string }
  | { ok: false; statusCode: 401 | 403; body: { code: string; message: string } };

async function verifyEngagementAccess(
  request: FastifyRequest,
  options: RegisterEngagementRoutesOptions
): Promise<EngagementAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);
  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Engagement requires profile and age verification"
      }
    };
  }

  return { ok: true, supabaseUserId: verifiedSession.supabaseUserId };
}

async function repositoryReply<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<T>,
  statusCode = 200
) {
  try {
    return reply.code(statusCode).send(await handler());
  } catch (error) {
    if (error instanceof EngagementRepositoryConfigurationError) {
      request.log.warn({ error }, "Engagement repository is not configured");
      return reply.code(503).send({
        code: "provider_unavailable",
        message: "Engagement is not configured"
      });
    }

    if (error instanceof EngagementPolicyError) {
      return reply.code(403).send({
        code: "forbidden",
        message: error.message
      });
    }

    throw error;
  }
}

function requireIdempotencyKey(request: FastifyRequest): { code: string; message: string } | null {
  const idempotencyKey = request.headers["idempotency-key"];
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0
    ? null
    : validationResponse("Idempotency-Key header is required");
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

function isFeedMode(value: unknown): value is NonNullable<UpdateFeedPreferencesRequest["defaultMode"]> {
  return typeof value === "string" && feedModes.has(value);
}

function isNsfwPreference(value: unknown): value is NonNullable<UpdateFeedPreferencesRequest["nsfwPreference"]> {
  return typeof value === "string" && nsfwPreferences.has(value);
}

function isShareTargetType(value: unknown): value is CreateShareRequest["targetType"] {
  return typeof value === "string" && shareTargetTypes.has(value);
}

function isShareMode(value: unknown): value is CreateShareRequest["mode"] {
  return typeof value === "string" && shareModes.has(value);
}

function isReportSubjectType(value: unknown): value is CreateReportRequest["subjectType"] {
  return typeof value === "string" && reportSubjectTypes.has(value);
}
