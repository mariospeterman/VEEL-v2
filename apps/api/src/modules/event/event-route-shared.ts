import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  AccessPass,
  AccessPassRequest,
  CreateEventRequest,
  EventRepository,
  Ticket,
  TicketRequest,
  UpdateEventRequest
} from "./types.js";

export interface RegisterEventRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
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

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
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

  if (!Array.isArray(body.ticketTypes) || body.ticketTypes.length === 0) {
    return "ticketTypes are required";
  }

  for (const ticketType of body.ticketTypes) {
    if (!ticketType.label || ticketType.label.trim().length === 0) {
      return "ticketTypes.label is required";
    }

    if (ticketType.currency !== "SOL") {
      return "ticketTypes.currency must be SOL for native launch Access Passes";
    }

    if (!Number.isSafeInteger(ticketType.capacity) || ticketType.capacity < 1) {
      return "ticketTypes.capacity must be at least 1";
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

export function accessPassIntentResponse(
  state: "free_granted",
  responseShape: "access_pass" | "ticket",
  ticket: Ticket
) {
  return responseShape === "ticket" ? { state, ticket } : { state, accessPass: toAccessPass(ticket) };
}

export function toAccessPass(ticket: Ticket): AccessPass {
  return {
    id: ticket.id,
    eventId: ticket.eventId,
    accessPassTypeId: ticket.ticketTypeId,
    holderUserId: ticket.holderUserId,
    state: ticket.state,
    qrToken: ticket.qrToken,
    createdAt: ticket.createdAt,
    ...(ticket.paymentIntentId !== undefined ? { paymentIntentId: ticket.paymentIntentId } : {}),
    ...(ticket.checkedInAt !== undefined ? { checkedInAt: ticket.checkedInAt } : {})
  };
}

export function toAccessPassRequest(ticketRequest: TicketRequest): AccessPassRequest {
  return {
    id: ticketRequest.id,
    eventId: ticketRequest.eventId,
    accessPassTypeId: ticketRequest.ticketTypeId,
    state: ticketRequest.state,
    createdAt: ticketRequest.createdAt
  };
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
