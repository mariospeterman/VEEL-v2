import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  CreateLiveRoomRequest,
  LiveProviderAdapter,
  LiveRepository,
  StoredLiveRoom
} from "./types.js";

export interface RegisterLiveRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  liveRepository: LiveRepository;
  liveProvider: LiveProviderAdapter;
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

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];

  return typeof idempotencyKey === "string" && idempotencyKey.length > 0
    ? idempotencyKey
    : null;
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
