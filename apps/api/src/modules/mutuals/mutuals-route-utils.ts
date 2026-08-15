import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type {
  MutualsInterestRequest,
  MutualsRepository,
  UpdateMutualsPreferencesRequest
} from "./types.js";

export interface RegisterMutualsRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  mutualsRepository: MutualsRepository;
}

export type MutualsAccessResult =
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

export async function verifyMutualsAccess(
  request: FastifyRequest,
  options: RegisterMutualsRoutesOptions
): Promise<MutualsAccessResult> {
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

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Mutuals mode requires profile and age verification"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

export function validatePreferences(
  body: Partial<UpdateMutualsPreferencesRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.activeMatchLimit !== undefined &&
    (!Number.isSafeInteger(body.activeMatchLimit) ||
      body.activeMatchLimit < 1 ||
      body.activeMatchLimit > 50)
  ) {
    return "activeMatchLimit must be between 1 and 50";
  }

  return null;
}

export function validateInterest(body: Partial<MutualsInterestRequest> | undefined): string | null {
  if (!body?.targetUserId) {
    return "targetUserId is required";
  }

  if (!body.contentId) {
    return "contentId is required";
  }

  if (body.action !== "yes" && body.action !== "not_interested") {
    return "action must be yes or not_interested";
  }

  return null;
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

export function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}

export function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}
