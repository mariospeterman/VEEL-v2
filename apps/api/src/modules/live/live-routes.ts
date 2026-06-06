import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import {
  PaymentIdempotencyConflictError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import {
  LiveRepositoryConfigurationError,
  LiveRoomIdempotencyConflictError
} from "./live-repository.js";
import { LiveProviderConfigurationError } from "./livepeer-adapter.js";
import type {
  CreateLiveChatMessageRequest,
  CreateLivePassIntentRequest,
  CreateLiveRoomRequest,
  LiveProviderAdapter,
  LiveRepository,
  StoredLiveRoom
} from "./types.js";

interface RegisterLiveRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  liveRepository: LiveRepository;
  liveProvider: LiveProviderAdapter;
}

const paymentIntentTtlMs = 15 * 60 * 1000;
const livePassDurations = new Set([30, 60, 180]);

export async function registerLiveRoutes(
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
      teaserSeconds: body?.teaserSeconds ?? 60,
      passPriceMinor: body?.passPriceMinor ?? 50_000_000
    };
    const requestHash = hashLiveRequest(normalizedBody);

    try {
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const existingRoom = await options.liveRepository.findOwnedRoomByIdempotency({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey
      });

      if (existingRoom) {
        if (existingRoom.requestHash !== requestHash) {
          return reply.code(409).send(conflictResponse("Idempotency key was already used"));
        }

        return reply.code(201).send(toLiveRoomResponse(existingRoom));
      }

      const providerRoom = await options.liveProvider.createRoom({
        roomId: "pending",
        title: normalizedBody.title
      });
      const room = await options.liveRepository.createRoom({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash,
        ...normalizedBody,
        providerRoom
      });

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

  app.post("/v1/live/rooms/:roomId/pass-intents", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateLivePassIntentRequest> | undefined;

    if (!body || !livePassDurations.has(Number(body.durationMinutes))) {
      return reply.code(400).send(validationResponse("durationMinutes must be 30, 60, or 180"));
    }

    if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
      return reply.code(503).send(serviceUnavailableResponse("Payment treasury wallet is not configured"));
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const room = await options.liveRepository.findRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      const durationMinutes = body.durationMinutes as 30 | 60 | 180;
      const passOption = room.passOptions.find((option) => option.durationMinutes === durationMinutes);

      if (!passOption) {
        return reply.code(400).send(validationResponse("durationMinutes is not available"));
      }

      const intentBody = {
        productType: "live_pass" as const,
        targetId: room.id,
        amountMinor: passOption.amountMinor,
        durationMinutes
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashLiveRequest(intentBody),
        productType: "live_pass",
        targetId: room.id,
        amountMinor: passOption.amountMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.liveRepository.recordLivePassPurchaseRequest({
        supabaseUserId: access.supabaseUserId,
        roomId: room.id,
        paymentIntentId: intent.id,
        durationMinutes,
        amountMinor: passOption.amountMinor,
        currency: "SOL"
      });

      return reply.code(201).send({
        id: intent.id,
        productType: intent.productType,
        targetId: intent.targetId,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        state: intent.state,
        referenceAddress: intent.referenceAddress,
        expiresAt: intent.expiresAt.toISOString()
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Live pass intent failed");
        return reply.code(503).send(serviceUnavailableResponse("Live pass payments are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/live/rooms/:roomId/messages", async (request, reply) => {
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

  app.post("/v1/live/rooms/:roomId/messages", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
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
        body: body.body.trim()
      });

      if (!message) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Live chat requires an active pass"
        });
      }

      return reply.code(201).send(message);
    } catch (error) {
      if (error instanceof LiveRepositoryConfigurationError) {
        request.log.warn({ error }, "Live chat write failed");
        return reply.code(503).send(serviceUnavailableResponse("Live chat is not configured"));
      }

      throw error;
    }
  });
}

type LiveReadyAccessResult =
  | {
      ok: true;
      supabaseUserId: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: {
        code: string;
        message: string;
      };
    };

async function verifyLiveReadyAccess(
  request: FastifyRequest,
  options: Pick<
    RegisterLiveRoutesOptions,
    "authVerifier" | "sessionRepository" | "ageRepository" | "walletRepository"
  >
): Promise<LiveReadyAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const profile = await options.sessionRepository.findProfileBySupabaseUserId(
    verifiedSession.supabaseUserId
  );
  const [ageStatus, hasWallet] = await Promise.all([
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Live rooms require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];

  return typeof idempotencyKey === "string" && idempotencyKey.length > 0
    ? idempotencyKey
    : null;
}

function validateCreateLiveRoomRequest(body: Partial<CreateLiveRoomRequest> | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return "title is required";
  }

  if (body.title.length > 120) {
    return "title must be 120 characters or fewer";
  }

  if (
    body.teaserSeconds !== undefined &&
    (!Number.isInteger(body.teaserSeconds) || body.teaserSeconds < 0 || body.teaserSeconds > 300)
  ) {
    return "teaserSeconds must be between 0 and 300";
  }

  if (
    body.passPriceMinor !== undefined &&
    (!Number.isInteger(body.passPriceMinor) || body.passPriceMinor <= 0)
  ) {
    return "passPriceMinor must be positive";
  }

  return null;
}

function toLiveRoomResponse(room: StoredLiveRoom) {
  const { providerStreamId, providerPlaybackId, hostIngestUrl, hostStreamKey, requestHash, ...response } =
    room;

  void providerStreamId;
  void providerPlaybackId;
  void hostIngestUrl;
  void hostStreamKey;
  void requestHash;

  return response;
}

async function withSignedLivePlayback(input: {
  room: StoredLiveRoom;
  supabaseUserId: string;
  liveProvider: LiveProviderAdapter;
}) {
  const response = toLiveRoomResponse(input.room);
  const playback = response.playback;

  if (playback?.state !== "full" || playback.provider !== "livepeer" || !playback.url) {
    return response;
  }

  const blockedPlayback: NonNullable<StoredLiveRoom["playback"]> = {
    state: "blocked",
    url: null,
    provider: "livepeer"
  };

  if (response.accessState !== "pass_active" || !input.room.providerPlaybackId) {
    return {
      ...response,
      playback: blockedPlayback
    };
  }

  try {
    const jwt = await input.liveProvider.createPlaybackJwt({
      playbackId: input.room.providerPlaybackId,
      supabaseUserId: input.supabaseUserId
    });

    if (!jwt) {
      return {
        ...response,
        playback: blockedPlayback
      };
    }

    const signedUrl = new URL(playback.url);
    signedUrl.searchParams.set("jwt", jwt);

    return {
      ...response,
      playback: {
        state: "full",
        url: signedUrl.toString(),
        provider: "livepeer",
        resourceType: "hls"
      }
    };
  } catch {
    return {
      ...response,
      playback: blockedPlayback
    };
  }
}

function hashLiveRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function maskIngestUrl(value: string | null): string {
  if (!value) {
    return "rtmp://rtmp.livepeer.com/live/****";
  }

  return value.replace(/\/[^/]+$/, "/****");
}

function streamKeyHint(value: string | null): string {
  if (!value || value.length <= 6) {
    return "****";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

function conflictResponse(message: string) {
  return {
    code: "conflict",
    message
  };
}

function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}

function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}
