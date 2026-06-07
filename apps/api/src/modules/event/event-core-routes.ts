import type { FastifyInstance } from "fastify";
import {
  EventIdempotencyConflictError,
  EventRepositoryConfigurationError
} from "./event-repository.js";
import type { CreateEventRequest, UpdateEventRequest } from "./types.js";
import {
  conflictResponse,
  hashJson,
  notFoundResponse,
  type RegisterEventRoutesOptions,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  validateEventDraft,
  validateEventPatch,
  validationResponse,
  verifyEventAccess
} from "./event-route-shared.js";

export async function registerEventCoreRoutes(
  app: FastifyInstance,
  options: RegisterEventRoutesOptions
): Promise<void> {
  app.post("/v1/events", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateEventRequest> | undefined;
    const validationError = validateEventDraft(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const eventBody = body as CreateEventRequest;
      const event = await options.eventRepository.createEvent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(eventBody),
        body: eventBody
      });

      return reply.code(201).send(event);
    } catch (error) {
      if (error instanceof EventIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event creation failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/events/:eventId", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";

    try {
      const event = await options.eventRepository.findEvent({
        supabaseUserId: access.supabaseUserId,
        eventId
      });

      if (!event) {
        return reply.code(404).send(notFoundResponse("Event was not found"));
      }

      return reply.code(200).send(event);
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });

  app.patch("/v1/events/:eventId", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";
    const body = request.body as Partial<UpdateEventRequest> | undefined;
    const validationError = validateEventPatch(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const event = await options.eventRepository.updateEvent({
        supabaseUserId: access.supabaseUserId,
        eventId,
        body: body as UpdateEventRequest
      });

      if (!event) {
        return reply.code(404).send(notFoundResponse("Event was not found"));
      }

      return reply.code(200).send(event);
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event update failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });
}
