import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  conflictResponse,
  hashJson,
  notFoundResponse,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  validationResponse,
  verifySubscriptionReadyAccess,
  type RegisterSubscriptionRoutesOptions
} from "./subscription-route-utils.js";
import {
  PlatformPlaybackNotQualifyingError,
  PlatformUsageLimitReachedError,
  PlatformUsageSequenceConflictError,
  SubscriptionIdempotencyConflictError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-repository.js";
import type {
  CreatePlatformPlaybackSessionRequest,
  RecordPlatformPlaybackHeartbeatRequest
} from "./types.js";

export async function registerPlatformUsageRoutes(
  app: FastifyInstance,
  options: RegisterSubscriptionRoutesOptions
): Promise<void> {
  app.post("/v1/platform-usage/playback-sessions", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreatePlatformPlaybackSessionRequest> | undefined;
    if (
      !body ||
      (body.targetType !== "content" && body.targetType !== "live_room") ||
      !isUuid(body.targetId)
    ) {
      return reply.code(400).send(validationResponse("targetType and a valid targetId are required"));
    }

    if (!options.subscriptionRepository.createPlatformPlaybackSession) {
      return reply.code(503).send(serviceUnavailableResponse("Platform usage is not configured"));
    }

    try {
      const input = body as CreatePlatformPlaybackSessionRequest;
      const session = await options.subscriptionRepository.createPlatformPlaybackSession({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(input),
        targetType: input.targetType,
        targetId: input.targetId
      });
      return reply.code(201).send(session);
    } catch (error) {
      return handlePlatformUsageError(request, reply, error);
    }
  });

  app.post(
    "/v1/platform-usage/playback-sessions/:playbackSessionId/heartbeats",
    async (request, reply) => {
      const access = await verifySubscriptionReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);

      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }

      const playbackSessionId =
        (request.params as { playbackSessionId?: string }).playbackSessionId ?? "";
      const body = request.body as Partial<RecordPlatformPlaybackHeartbeatRequest> | undefined;
      if (
        !isUuid(playbackSessionId) ||
        !body ||
        !Number.isInteger(body.sequence) ||
        Number(body.sequence) < 1 ||
        !Number.isInteger(body.playedSeconds) ||
        Number(body.playedSeconds) < 1 ||
        Number(body.playedSeconds) > 30
      ) {
        return reply.code(400).send(validationResponse("A valid session, sequence, and playedSeconds are required"));
      }

      if (!options.subscriptionRepository.recordPlatformPlaybackHeartbeat) {
        return reply.code(503).send(serviceUnavailableResponse("Platform usage is not configured"));
      }

      try {
        const heartbeat = body as RecordPlatformPlaybackHeartbeatRequest;
        const session = await options.subscriptionRepository.recordPlatformPlaybackHeartbeat({
          supabaseUserId: access.supabaseUserId,
          playbackSessionId,
          idempotencyKey,
          requestHash: hashJson(heartbeat),
          sequence: heartbeat.sequence,
          playedSeconds: heartbeat.playedSeconds
        });

        if (!session) {
          return reply.code(404).send(notFoundResponse("Playback session was not found"));
        }

        return reply.code(200).send(session);
      } catch (error) {
        return handlePlatformUsageError(request, reply, error);
      }
    }
  );
}

function handlePlatformUsageError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof PlatformPlaybackNotQualifyingError) {
    return reply.code(400).send(validationResponse("Playback does not consume the public-media allowance"));
  }
  if (error instanceof PlatformUsageLimitReachedError) {
    return reply.code(403).send({
      code: "forbidden",
      message: "Public-media allowance is exhausted"
    });
  }
  if (
    error instanceof PlatformUsageSequenceConflictError ||
    error instanceof SubscriptionIdempotencyConflictError
  ) {
    return reply.code(409).send(conflictResponse("Playback usage request conflicts with recorded state"));
  }
  if (error instanceof SubscriptionRepositoryConfigurationError) {
    request.log.warn({ error }, "Platform usage accounting failed");
    return reply.code(503).send(serviceUnavailableResponse("Platform usage is not configured"));
  }
  throw error;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
