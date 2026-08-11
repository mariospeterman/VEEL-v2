import type { FastifyInstance } from "fastify";
import {
  LiveRepositoryConfigurationError,
  LiveRoomIdempotencyConflictError
} from "./live-repository.js";
import { LiveProviderConfigurationError } from "./livepeer-adapter.js";
import type { CreateLiveRoomRequest } from "./types.js";
import {
  conflictResponse,
  hashLiveRequest,
  maskIngestUrl,
  notFoundResponse,
  type RegisterLiveRoutesOptions,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  streamKeyHint,
  toLiveRoomResponse,
  validateCreateLiveRoomRequest,
  verifyLiveReadyAccess,
  withSignedLivePlayback,
  validationResponse
} from "./live-route-shared.js";

export async function registerLiveRoomRoutes(
  app: FastifyInstance,
  options: RegisterLiveRoutesOptions
): Promise<void> {
  app.post("/v1/live/rooms", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateLiveRoomRequest> | undefined;
    const validationError = validateCreateLiveRoomRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    if (!options.liveProvider.isConfigured()) {
      return reply.code(503).send(serviceUnavailableResponse("Livepeer is not configured"));
    }

    const normalizedBody = {
      title: body?.title?.trim() ?? "",
      accessMode: body?.accessMode ?? "public",
      previewSeconds: body?.previewSeconds ?? 60,
      eventPriceMinor: body?.accessMode === "paid_event" ? (body.eventPriceMinor ?? null) : null,
      membersOnlyChat: body?.membersOnlyChat ?? false,
      membersIncludedInPaidEvent:
        body?.accessMode === "paid_event" ? (body.membersIncludedInPaidEvent ?? false) : false,
      replayWindowHours: body?.replayWindowHours ?? 48
    };
    const requestHash = hashLiveRequest(normalizedBody);

    try {
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const existingRoom = await options.liveRepository.findOwnedRoomByIdempotency({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey
      });

      if (existingRoom?.requestHash !== undefined && existingRoom.requestHash !== requestHash) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (existingRoom?.providerStreamId) {
        return reply.code(201).send(toLiveRoomResponse(existingRoom));
      }

      const reservedRoom =
        existingRoom ??
        (await options.liveRepository.reserveRoom({
          supabaseUserId: access.supabaseUserId,
          idempotencyKey,
          requestHash,
          ...normalizedBody
        }));
      const providerRoom = await options.liveProvider.createRoom({
        roomId: reservedRoom.id,
        title: normalizedBody.title
      });

      const room = await options.liveRepository.attachProviderRoom({
        supabaseUserId: access.supabaseUserId,
        roomId: reservedRoom.id,
        providerRoom
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      return reply.code(201).send(toLiveRoomResponse(room));
    } catch (error) {
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderConfigurationError
      ) {
        request.log.warn({ error }, "Live room creation failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      if (error instanceof LiveRoomIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      throw error;
    }
  });

  app.get("/v1/live/rooms/:roomId", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      const room = await options.liveRepository.findRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      const response = await withSignedLivePlayback({
        room,
        supabaseUserId: access.supabaseUserId,
        liveProvider: options.liveProvider
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderConfigurationError
      ) {
        request.log.warn({ error }, "Live room lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/live/rooms/:roomId/host-connection", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      const room = await options.liveRepository.findOwnedRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      return reply.code(200).send({
        provider: "livepeer",
        maskedIngestUrl: maskIngestUrl(room.hostIngestUrl),
        streamKeyHint: streamKeyHint(room.hostStreamKey)
      });
    } catch (error) {
      if (error instanceof LiveRepositoryConfigurationError) {
        request.log.warn({ error }, "Live host connection lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/live/rooms/:roomId/sync", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      const room = await options.liveRepository.findOwnedRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      if (!room.providerStreamId) {
        return reply.code(503).send(serviceUnavailableResponse("Live room provider setup is pending"));
      }

      const status = await options.liveProvider.getRoomStatus({
        providerStreamId: room.providerStreamId,
        providerPlaybackId: room.providerPlaybackId
      });

      await options.liveRepository.updateRoomStatus({ roomId: room.id, status });

      return reply.code(202).send();
    } catch (error) {
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderConfigurationError
      ) {
        request.log.warn({ error }, "Live room sync failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      throw error;
    }
  });
}
