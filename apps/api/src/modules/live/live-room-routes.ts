import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { hasRecentAuthentication } from "../auth/http-auth.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import {
  LiveControlIdempotencyConflictError,
  LiveRepositoryConfigurationError,
  LiveRoomIdempotencyConflictError
} from "./live-repository.js";
import { LiveProviderError, LiveProviderRequestError } from "./livepeer-adapter.js";
import type { CreateLiveRoomRequest, RevealLiveHostConnectionRequest } from "./types.js";
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
  app.post("/v1/live/rooms", mutationRateLimit("accessMutation", "createLiveRoom"), async (request, reply) => {
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
      sfwAttestation: body?.sfwAttestation,
      accessMode: body?.accessMode ?? "public",
      previewSeconds: body?.previewSeconds ?? 60,
      eventPriceMinor: body?.accessMode === "paid_event" ? (body.eventPriceMinor ?? null) : null,
      membersOnlyChat: body?.membersOnlyChat ?? false,
      membersIncludedInPaidEvent:
        body?.accessMode === "paid_event" ? (body.membersIncludedInPaidEvent ?? false) : false,
          replayWindowHours: body?.replayWindowHours ?? 48
    };
    const requestHash = hashLiveRequest(normalizedBody);

    let createdProviderRoom: Awaited<ReturnType<typeof options.liveProvider.createRoom>> | null = null;
    try {
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
      const claimId = randomUUID();
      const claimed = await options.liveRepository.claimProviderCreation({
        supabaseUserId: access.supabaseUserId,
        roomId: reservedRoom.id,
        claimId
      });
      if (!claimed) {
        const currentRoom = await options.liveRepository.findOwnedRoomByIdempotency({
          supabaseUserId: access.supabaseUserId,
          idempotencyKey
        });
        if (currentRoom?.providerStreamId) {
          return reply.code(201).send(toLiveRoomResponse(currentRoom));
        }
        return reply.code(409).send(conflictResponse("Live room setup is already in progress"));
      }

      createdProviderRoom = await options.liveProvider.createRoom({
        roomId: reservedRoom.id,
        title: normalizedBody.title
      });

      const room = await options.liveRepository.attachProviderRoom({
        supabaseUserId: access.supabaseUserId,
        roomId: reservedRoom.id,
        claimId,
        providerRoom: createdProviderRoom
      });

      if (!room) {
        await containUnattachedProviderRoom(options.liveProvider, createdProviderRoom);
        createdProviderRoom = null;
        return reply.code(503).send(serviceUnavailableResponse("Live room setup could not be finalized"));
      }

      return reply.code(201).send(toLiveRoomResponse(room));
    } catch (error) {
      if (createdProviderRoom) {
        await containUnattachedProviderRoom(options.liveProvider, createdProviderRoom);
      }
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderError
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

  app.get("/v1/live/rooms/mine", { schema: contractRouteSchema("listMyLiveRooms") }, async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    try {
      const page = await options.liveRepository.listOwnedRooms({
        supabaseUserId: access.supabaseUserId
      });
      return reply.code(200).send({
        items: page.items.map(toLiveRoomResponse),
        nextCursor: page.nextCursor
      });
    } catch (error) {
      if (error instanceof LiveRepositoryConfigurationError) {
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are unavailable"));
      }
      throw error;
    }
  });

  app.get("/v1/live/rooms/:roomId", { schema: contractRouteSchema("getLiveRoom") }, async (request, reply) => {
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
        appUserId: access.appUserId,
        liveProvider: options.liveProvider,
        subscriptionRepository: options.subscriptionRepository
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderError
      ) {
        request.log.warn({ error }, "Live room lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/live/rooms/:roomId/host-connection", { schema: contractRouteSchema("getLiveHostConnection") }, async (request, reply) => {
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

  app.post(
    "/v1/live/rooms/:roomId/host-connection/reveal",
    mutationRateLimit("accessMutation", "revealLiveHostConnection"),
    async (request, reply) => {
      const access = await verifyLiveReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      if (!hasRecentAuthentication(access.authenticatedAt)) {
        return reply.code(403).send({
          code: "recent_authentication_required",
          message: "Authenticate again before revealing OBS credentials"
        });
      }

      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }
      const body = request.body as Partial<RevealLiveHostConnectionRequest> | undefined;
      if (body?.acknowledgement !== "i_understand_stream_keys_are_secrets") {
        return reply.code(400).send(validationResponse("Confirm the stream-key security warning"));
      }
      const roomId = (request.params as { roomId?: string }).roomId ?? "";

      try {
        const connection = await options.liveRepository.revealHostConnection({
          supabaseUserId: access.supabaseUserId,
          roomId,
          idempotencyKey,
          requestHash: hashLiveRequest({ roomId, acknowledgement: body.acknowledgement })
        });
        if (!connection) return reply.code(404).send(notFoundResponse("Live room was not found"));
        reply.header("cache-control", "no-store, max-age=0");
        reply.header("pragma", "no-cache");
        return reply.code(200).send(connection);
      } catch (error) {
        if (error instanceof LiveControlIdempotencyConflictError) {
          return reply.code(409).send(conflictResponse("Idempotency key was already used"));
        }
        if (error instanceof LiveRepositoryConfigurationError) {
          return reply.code(503).send(serviceUnavailableResponse("Live host setup is unavailable"));
        }
        throw error;
      }
    }
  );

  app.post(
    "/v1/live/rooms/:roomId/end",
    mutationRateLimit("accessMutation", "endLiveRoom"),
    async (request, reply) => {
      const access = await verifyLiveReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }
      const roomId = (request.params as { roomId?: string }).roomId ?? "";
      let control: Awaited<ReturnType<typeof options.liveRepository.reserveOwnedControl>> = null;
      try {
        control = await options.liveRepository.reserveOwnedControl({
          supabaseUserId: access.supabaseUserId,
          roomId,
          action: "creator_ended",
          idempotencyKey,
          requestHash: hashLiveRequest({ roomId, action: "creator_ended" })
        });
        if (!control) return reply.code(404).send(notFoundResponse("Live room was not found"));
        if (control.state !== "completed") {
          try {
            await options.liveProvider.terminateRoom({ providerStreamId: control.providerStreamId });
          } catch (error) {
            if (!(error instanceof LiveProviderRequestError && error.kind === "not_found")) throw error;
          }
          await options.liveRepository.completeControl({
            controlId: control.id,
            state: "ended",
            providerState: "terminated"
          });
        }
        return reply.code(202).send();
      } catch (error) {
        if (error instanceof LiveControlIdempotencyConflictError) {
          return reply.code(409).send(conflictResponse("Idempotency key was already used"));
        }
        if (error instanceof LiveProviderError && control) {
          await options.liveRepository.failControl({
            controlId: control.id,
            providerFailureKind: error instanceof LiveProviderRequestError ? error.kind : "configuration",
            providerStatusCode: error instanceof LiveProviderRequestError ? error.statusCode : null
          });
          request.log.warn({ roomId, providerFailure: true }, "Live room end provider control failed");
          return reply.code(503).send(serviceUnavailableResponse("The room is closed locally; provider shutdown will be retried"));
        }
        if (error instanceof LiveRepositoryConfigurationError) {
          return reply.code(503).send(serviceUnavailableResponse("Live controls are unavailable"));
        }
        throw error;
      }
    }
  );

  app.post("/v1/live/rooms/:roomId/sync", mutationRateLimit("accessMutation", "syncLiveRoom"), async (request, reply) => {
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

      const providerObservationCutoff =
        await options.liveRepository.captureProviderObservationCutoff();
      const status = await options.liveProvider.getRoomStatus({
        providerStreamId: room.providerStreamId,
        providerPlaybackId: room.providerPlaybackId
      });

      await options.liveRepository.updateRoomStatus({
        providerObservationCutoff,
        roomId: room.id,
        status
      });

      return reply.code(202).send();
    } catch (error) {
      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof LiveProviderError
      ) {
        request.log.warn({ error }, "Live room sync failed");
        return reply.code(503).send(serviceUnavailableResponse("Live rooms are not configured"));
      }

      throw error;
    }
  });
}

async function containUnattachedProviderRoom(
  liveProvider: RegisterLiveRoutesOptions["liveProvider"],
  room: Awaited<ReturnType<RegisterLiveRoutesOptions["liveProvider"]["createRoom"]>>
) {
  try {
    await liveProvider.setRoomSuspended({ providerStreamId: room.providerStreamId, suspended: true });
  } catch {
    // Termination is still required when the defensive suspension request fails.
  }

  try {
    await liveProvider.terminateRoom({ providerStreamId: room.providerStreamId });
  } catch {
    // The database remains fail-closed; provider reconciliation is retried operationally.
  }
}
