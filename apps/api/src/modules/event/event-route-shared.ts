import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  AccessPass,
  AccessPassRequest,
  CreateEventRequest,
  EventRepository,
  UpdateEventRequest
} from "./types.js";

export interface RegisterEventRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  eventRepository: EventRepository;
}

type EventAccessResult =
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

export async function verifyEventAccess(
  request: FastifyRequest,
  options: RegisterEventRoutesOptions
): Promise<EventAccessResult> {
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
        message: "Events require profile and age verification"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

export function validateEventDraft(body: Partial<CreateEventRequest> | undefined): string | null {
  if (!body || typeof body.title !== "string" || body.title.trim().length === 0) {
    return "title is required";
  }

  if (!body.startsAt || Number.isNaN(Date.parse(body.startsAt))) {
    return "startsAt is required";
  }

  if (body.endsAt && Date.parse(body.endsAt) <= Date.parse(body.startsAt)) {
    return "endsAt must be after startsAt";
  }

  if (body.accessRule !== "public_sale" && body.accessRule !== "private_apply") {
    return "accessRule is required";
  }

  if (!body.location || !["digital_live_stream", "physical"].includes(body.location.type ?? "")) {
    return "location.type is required";
  }

  if (!Array.isArray(body.accessPassTypes) || body.accessPassTypes.length === 0) {
    return "accessPassTypes are required";
  }

  for (const accessPassType of body.accessPassTypes) {
    if (!accessPassType.label || accessPassType.label.trim().length === 0) {
      return "accessPassTypes.label is required";
    }

    if (accessPassType.currency !== "SOL") {
      return "accessPassTypes.currency must be SOL for native launch Access Passes";
    }

    if (!Number.isSafeInteger(accessPassType.capacity) || accessPassType.capacity < 1) {
      return "accessPassTypes.capacity must be at least 1";
    }
  }

  return null;
}

export function validateEventPatch(body: Partial<UpdateEventRequest> | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (body.state && !["draft", "published", "sold_out", "cancelled", "completed"].includes(body.state)) {
    return "state is invalid";
  }

  if (body.title !== undefined && body.title.trim().length === 0) {
    return "title cannot be empty";
  }

  return null;
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function accessPassIntentResponse(state: "free_granted", accessPass: AccessPass) {
  return { state, accessPass };
}

export function toAccessPass(accessPass: AccessPass): AccessPass {
  return accessPass;
}

export function toAccessPassRequest(accessPassRequest: AccessPassRequest): AccessPassRequest {
  return accessPassRequest;
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
