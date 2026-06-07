import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import {
  PaymentIdempotencyConflictError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import type { PaymentRepository } from "../payment/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import {
  EventIdempotencyConflictError,
  EventRepositoryConfigurationError
} from "./event-repository.js";
import type {
  AccessPass,
  AccessPassRequest,
  CheckInAccessPassRequest,
  CheckInTicketRequest,
  CreateAccessPassIntentRequest,
  CreateAccessPassRequestRequest,
  CreateEventRequest,
  CreateTicketIntentRequest,
  CreateTicketRequestRequest,
  EventRepository,
  Ticket,
  TicketRequest,
  UpdateEventRequest
} from "./types.js";

interface RegisterEventRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  eventRepository: EventRepository;
}

const paymentIntentTtlMs = 15 * 60 * 1000;

export async function registerEventRoutes(
  app: FastifyInstance,
  options: RegisterEventRoutesOptions
): Promise<void> {
  app.post("/v1/events", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateEventRequest> | undefined;
    const validationError = validateEventDraft(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const eventBody = body as CreateEventRequest;
      const event = await options.eventRepository.createEvent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(eventBody),
        body: eventBody
      });

      return reply.code(201).send(event);
    } catch (error) {
      if (error instanceof EventIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event creation failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/events/:eventId", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";

    try {
      const event = await options.eventRepository.findEvent({
        supabaseUserId: access.supabaseUserId,
        eventId
      });

      if (!event) {
        return reply.code(404).send(notFoundResponse("Event was not found"));
      }

      return reply.code(200).send(event);
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });

  app.patch("/v1/events/:eventId", async (request, reply) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";
    const body = request.body as Partial<UpdateEventRequest> | undefined;
    const validationError = validateEventPatch(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const event = await options.eventRepository.updateEvent({
        supabaseUserId: access.supabaseUserId,
        eventId,
        body: body as UpdateEventRequest
      });

      if (!event) {
        return reply.code(404).send(notFoundResponse("Event was not found"));
      }

      return reply.code(200).send(event);
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Event update failed");
        return reply.code(503).send(serviceUnavailableResponse("Events are not configured"));
      }

      throw error;
    }
  });

  const createAccessPassIntent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    responseShape: "access_pass" | "ticket"
  ) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as AccessPassIntentBody | undefined;
    const accessPassTypeId = getAccessPassTypeId(body);

    if (!accessPassTypeId) {
      return reply.code(400).send(validationResponse("accessPassTypeId is required"));
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";

    try {
      const offer = await options.eventRepository.findTicketOffer({
        supabaseUserId: access.supabaseUserId,
        eventId,
        ticketTypeId: accessPassTypeId
      });

      if (!offer) {
        return reply.code(404).send(notFoundResponse("Access Pass offer was not found"));
      }

      if (offer.alreadyIssuedTicket) {
        return reply
          .code(201)
          .send(accessPassIntentResponse("free_granted", responseShape, offer.alreadyIssuedTicket));
      }

      if (offer.event.accessRule === "private_apply") {
        return reply.code(201).send({ state: "approval_required" });
      }

      if (!offer.ticketType.priceMinor || offer.ticketType.priceMinor <= 0) {
        const ticket = await options.eventRepository.grantFreeTicket({
          supabaseUserId: access.supabaseUserId,
          eventId,
          ticketTypeId: accessPassTypeId
        });

        if (!ticket) {
          return reply.code(409).send(conflictResponse("Access Pass inventory is no longer available"));
        }

        return reply.code(201).send(accessPassIntentResponse("free_granted", responseShape, ticket));
      }

      if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
        return reply.code(503).send(serviceUnavailableResponse("Payment treasury wallet is not configured"));
      }

      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);

      const hasWallet = await options.walletRepository.hasWalletBySupabaseUserId(access.supabaseUserId);

      if (!hasWallet) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Paid Access Passes require wallet readiness"
        });
      }

      const intentBody = {
        productType: "event_access_pass" as const,
        targetId: eventId,
        accessPassTypeId,
        amountMinor: offer.ticketType.priceMinor
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(intentBody),
        productType: "event_access_pass",
        targetId: eventId,
        amountMinor: offer.ticketType.priceMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.eventRepository.recordTicketPurchaseRequest({
        supabaseUserId: access.supabaseUserId,
        eventId,
        ticketTypeId: accessPassTypeId,
        paymentIntentId: intent.id,
        amountMinor: offer.ticketType.priceMinor,
        currency: "SOL"
      });

      return reply.code(201).send({
        state: "payment_required",
        paymentIntent: {
          id: intent.id,
          productType: intent.productType,
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          state: intent.state
        }
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (
        error instanceof EventRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Access Pass intent failed");
        return reply.code(503).send(serviceUnavailableResponse("Access Pass payments are not configured"));
      }

      throw error;
    }
  };

  const requestAccessPass = async (
    request: FastifyRequest,
    reply: FastifyReply,
    responseShape: "access_pass" | "ticket"
  ) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as AccessPassRequestBody | undefined;
    const accessPassTypeId = getAccessPassTypeId(body);

    if (!accessPassTypeId) {
      return reply.code(400).send(validationResponse("accessPassTypeId is required"));
    }

    const note = body?.note;

    if (note !== undefined && note !== null && note.length > 500) {
      return reply.code(400).send(validationResponse("note must be 500 characters or fewer"));
    }

    const eventId = (request.params as { eventId?: string }).eventId ?? "";

    try {
      const offer = await options.eventRepository.findTicketOffer({
        supabaseUserId: access.supabaseUserId,
        eventId,
        ticketTypeId: accessPassTypeId
      });

      if (!offer || offer.event.accessRule !== "private_apply") {
        return reply.code(404).send(notFoundResponse("Private Access Pass offer was not found"));
      }

      const ticketRequest = await options.eventRepository.createTicketRequest({
        supabaseUserId: access.supabaseUserId,
        eventId,
        ticketTypeId: accessPassTypeId,
        note: note?.trim() || null
      });

      if (!ticketRequest) {
        return reply.code(404).send(notFoundResponse("Private Access Pass offer was not found"));
      }

      return reply
        .code(201)
        .send(responseShape === "ticket" ? ticketRequest : toAccessPassRequest(ticketRequest));
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Access Pass request failed");
        return reply.code(503).send(serviceUnavailableResponse("Access Pass requests are not configured"));
      }

      throw error;
    }
  };

  const checkInAccessPass = async (
    request: FastifyRequest,
    reply: FastifyReply,
    responseShape: "access_pass" | "ticket"
  ) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CheckInAccessPassRequest & CheckInTicketRequest> | undefined;

    if (!body?.qrToken) {
      return reply.code(400).send(validationResponse("qrToken is required"));
    }

    const params = request.params as { accessPassId?: string; ticketId?: string };
    const accessPassId = params.accessPassId ?? params.ticketId ?? "";

    try {
      const ticket = await options.eventRepository.checkInTicket({
        supabaseUserId: access.supabaseUserId,
        ticketId: accessPassId,
        qrToken: body.qrToken
      });

      if (!ticket) {
        return reply.code(404).send(notFoundResponse("Access Pass was not found"));
      }

      return reply.code(200).send(responseShape === "ticket" ? ticket : toAccessPass(ticket));
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Access Pass check-in failed");
        return reply.code(503).send(serviceUnavailableResponse("Access Pass check-in is not configured"));
      }

      throw error;
    }
  };

  app.post("/v1/events/:eventId/access-passes/intents", (request, reply) =>
    createAccessPassIntent(request, reply, "access_pass")
  );
  app.post("/v1/events/:eventId/tickets/intents", (request, reply) =>
    createAccessPassIntent(request, reply, "ticket")
  );
  app.post("/v1/events/:eventId/access-passes/requests", (request, reply) =>
    requestAccessPass(request, reply, "access_pass")
  );
  app.post("/v1/events/:eventId/tickets/requests", (request, reply) =>
    requestAccessPass(request, reply, "ticket")
  );
  app.post("/v1/access-passes/:accessPassId/check-in", (request, reply) =>
    checkInAccessPass(request, reply, "access_pass")
  );
  app.post("/v1/tickets/:ticketId/check-in", (request, reply) => checkInAccessPass(request, reply, "ticket"));
}

type AccessPassIntentBody = Partial<CreateAccessPassIntentRequest & CreateTicketIntentRequest>;
type AccessPassRequestBody = Partial<CreateAccessPassRequestRequest & CreateTicketRequestRequest>;

function getAccessPassTypeId(body: AccessPassIntentBody | AccessPassRequestBody | undefined): string | null {
  return body?.accessPassTypeId ?? body?.ticketTypeId ?? null;
}

function accessPassIntentResponse(
  state: "free_granted",
  responseShape: "access_pass" | "ticket",
  ticket: Ticket
) {
  return responseShape === "ticket" ? { state, ticket } : { state, accessPass: toAccessPass(ticket) };
}

function toAccessPass(ticket: Ticket): AccessPass {
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

function toAccessPassRequest(ticketRequest: TicketRequest): AccessPassRequest {
  return {
    id: ticketRequest.id,
    eventId: ticketRequest.eventId,
    accessPassTypeId: ticketRequest.ticketTypeId,
    state: ticketRequest.state,
    createdAt: ticketRequest.createdAt
  };
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

async function verifyEventAccess(
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

function validateEventDraft(body: Partial<CreateEventRequest> | undefined): string | null {
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

function validateEventPatch(body: Partial<UpdateEventRequest> | undefined): string | null {
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

function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : null;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}

function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}
