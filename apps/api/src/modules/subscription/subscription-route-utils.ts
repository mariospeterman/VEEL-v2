import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  CreateSubscriptionIntentRequest,
  SubmitSubscriptionAuthorizationRequest,
  SubscriptionAuthorizationVerifier,
  SubscriptionRepository
} from "./types.js";

export interface RegisterSubscriptionRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  subscriptionRepository: SubscriptionRepository;
  subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier;
}

export type SubscriptionReadyAccessResult =
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

export async function verifySubscriptionReadyAccess(
  request: FastifyRequest,
  options: RegisterSubscriptionRoutesOptions
): Promise<SubscriptionReadyAccessResult> {
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
        message: "Subscriptions require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

export function validateCreateSubscriptionIntent(
  body: Partial<CreateSubscriptionIntentRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.planId !== "string" || body.planId.length === 0) {
    return "planId is required";
  }

  if (
    body.creatorUserId !== undefined &&
    (typeof body.creatorUserId !== "string" || body.creatorUserId.length === 0)
  ) {
    return "creatorUserId must be a non-empty string when provided";
  }

  return null;
}

export function validateSubmitSubscriptionAuthorization(
  body: Partial<SubmitSubscriptionAuthorizationRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  for (const field of ["signature", "authorityAddress", "delegationAddress", "subscriberTokenAccount"] as const) {
    if (typeof body[field] !== "string" || body[field].length === 0) {
      return `${field} is required`;
    }
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
