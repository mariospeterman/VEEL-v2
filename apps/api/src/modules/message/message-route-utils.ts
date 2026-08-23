import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  CreateMessageRequest,
  MessageRepository
} from "./types.js";

export interface RegisterMessageRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  messageRepository: MessageRepository;
}

export type MessageReadyAccessResult =
  | {
      ok: true;
      userId: string;
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

export async function verifyMessageReadyAccess(
  request: FastifyRequest,
  options: Pick<
    RegisterMessageRoutesOptions,
    "authVerifier" | "sessionRepository" | "ageRepository" | "walletRepository"
  >
): Promise<MessageReadyAccessResult> {
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
        message: "Messages require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    userId: verifiedSession.userId,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function validateMessageBody(
  body: Partial<CreateMessageRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.body !== "string" || body.body.trim().length === 0) {
    return "body is required";
  }

  if (body.body.length > 4000) {
    return "body must be 4000 characters or fewer";
  }

  return null;
}

export function hashPaymentRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashMessageBody(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashMessageActionRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validationResponse(message: string) {
  return { code: "validation_failed", message };
}

export function conflictResponse(message: string) {
  return { code: "conflict", message };
}

export function notFoundResponse(message: string) {
  return { code: "not_found", message };
}

export function serviceUnavailableResponse(message: string) {
  return { code: "service_unavailable", message };
}
