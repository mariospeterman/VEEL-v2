import type { FastifyInstance } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import {
  LiveChatIdempotencyConflictError,
  LiveRepositoryConfigurationError
} from "./live-repository.js";
import type { CreateLiveChatMessageRequest } from "./types.js";
import {
  notFoundResponse,
  conflictResponse,
  hashLiveRequest,
  type RegisterLiveRoutesOptions,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  validationResponse,
  verifyLiveReadyAccess
} from "./live-route-shared.js";

export async function registerLiveChatRoutes(
  app: FastifyInstance,
  options: RegisterLiveRoutesOptions
): Promise<void> {
  app.get("/v1/live/rooms/:roomId/messages", { schema: contractRouteSchema("listLiveRoomMessages") }, async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      const page = await options.liveRepository.listChatMessages({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!page) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof LiveRepositoryConfigurationError) {
        request.log.warn({ error }, "Live chat lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Live chat is not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/live/rooms/:roomId/messages", mutationRateLimit("messageMutation", "createLiveRoomMessage"), async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateLiveChatMessageRequest> | undefined;

    if (!body || typeof body.body !== "string" || body.body.trim().length === 0) {
      return reply.code(400).send(validationResponse("body is required"));
    }

    if (body.body.length > 500) {
      return reply.code(400).send(validationResponse("body must be 500 characters or fewer"));
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      const message = await options.liveRepository.createChatMessage({
        supabaseUserId: access.supabaseUserId,
        roomId,
        body: body.body.trim(),
        idempotencyKey,
        requestHash: hashLiveRequest({ roomId, body: body.body.trim() })
      });

      if (!message) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Live chat is not available for this account or room"
        });
      }

      return reply.code(201).send(message);
    } catch (error) {
      if (error instanceof LiveChatIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }
      if (error instanceof LiveRepositoryConfigurationError) {
        request.log.warn({ error }, "Live chat write failed");
        return reply.code(503).send(serviceUnavailableResponse("Live chat is not configured"));
      }

      throw error;
    }
  });
}
