import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { SubscriptionRepository } from "../subscription/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  CreateLiveRoomRequest,
  LiveProviderAdapter,
  LiveRepository,
  StoredLiveRoom
} from "./types.js";

export interface RegisterLiveRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  liveRepository: LiveRepository;
  liveProvider: LiveProviderAdapter;
  subscriptionRepository: SubscriptionRepository;
}

type LiveReadyAccessResult =
  | {
      ok: true;
      supabaseUserId: string;
      appUserId: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: {
        code: string;
        message: string;
      };
    };

export async function verifyLiveReadyAccess(
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

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
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
    supabaseUserId: verifiedSession.supabaseUserId,
    appUserId: profile.id
  };
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function validateCreateLiveRoomRequest(
  body: Partial<CreateLiveRoomRequest> | undefined
): string | null {
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
    body.accessMode !== undefined &&
    !["public", "profile_members", "paid_event"].includes(body.accessMode)
  ) {
    return "accessMode must be public, profile_members, or paid_event";
  }

  if (
    body.previewSeconds !== undefined &&
    (!Number.isInteger(body.previewSeconds) || body.previewSeconds < 0 || body.previewSeconds > 300)
  ) {
    return "previewSeconds must be between 0 and 300";
  }

  const accessMode = body.accessMode ?? "public";

  if (accessMode === "paid_event") {
    if (!Number.isInteger(body.eventPriceMinor) || Number(body.eventPriceMinor) <= 0) {
      return "eventPriceMinor is required for paid_event access";
    }
  } else if (body.eventPriceMinor !== undefined) {
    return "eventPriceMinor is only allowed for paid_event access";
  }

  if (body.membersIncludedInPaidEvent && accessMode !== "paid_event") {
    return "membersIncludedInPaidEvent is only allowed for paid_event access";
  }

  if (
    body.replayWindowHours !== undefined &&
    (!Number.isInteger(body.replayWindowHours) ||
      body.replayWindowHours < 0 ||
      body.replayWindowHours > 720)
  ) {
    return "replayWindowHours must be between 0 and 720";
  }

  return null;
}

export function toLiveRoomResponse(room: StoredLiveRoom) {
  const { providerStreamId, providerPlaybackId, hostIngestUrl, hostStreamKey, requestHash, ...response } =
    room;

  void providerStreamId;
  void providerPlaybackId;
  void hostIngestUrl;
  void hostStreamKey;
  void requestHash;

  return response;
}

export async function withSignedLivePlayback(input: {
  room: StoredLiveRoom;
  supabaseUserId: string;
  liveProvider: LiveProviderAdapter;
  subscriptionRepository: SubscriptionRepository;
  appUserId: string;
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

  if (response.accessState !== "allowed" || !input.room.providerPlaybackId) {
    return {
      ...response,
      playback: blockedPlayback
    };
  }

  let usage: NonNullable<StoredLiveRoom["playback"]>["usage"] | undefined;
  const potentiallyAccounted =
    response.accessMode === "public" && response.creator.id !== input.appUserId;

  if (potentiallyAccounted) {
    if (!input.subscriptionRepository.getPlatformPlaybackDecision) {
      return {
        ...response,
        playback: { ...blockedPlayback, blockReason: "provider_unavailable" }
      };
    }

    try {
      const decision = await input.subscriptionRepository.getPlatformPlaybackDecision({
        supabaseUserId: input.supabaseUserId,
        targetType: "live_room",
        targetId: response.id
      });
      if (decision.limitReached) {
        return {
          ...response,
          playback: { ...blockedPlayback, blockReason: "allowance_exhausted" }
        };
      }
      if (decision.countsTowardAllowance) {
        usage = {
          policy: "public_media_allowance",
          targetType: "live_room",
          targetId: response.id,
          heartbeatIntervalSeconds: 15
        };
      }
    } catch {
      return {
        ...response,
        playback: { ...blockedPlayback, blockReason: "provider_unavailable" }
      };
    }
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
        resourceType: "hls",
        ...(usage ? { usage } : {})
      }
    };
  } catch {
    return {
      ...response,
      playback: blockedPlayback
    };
  }
}

export function hashLiveRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function maskIngestUrl(value: string | null): string {
  if (!value) {
    return "rtmp://rtmp.livepeer.com/live/****";
  }

  return value.replace(/\/[^/]+$/, "/****");
}

export function streamKeyHint(value: string | null): string {
  if (!value || value.length <= 6) {
    return "****";
  }

  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

export function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

export function conflictResponse(message: string) {
  return {
    code: "conflict",
    message
  };
}

export function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}

export function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}
