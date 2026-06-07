import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PaymentIdempotencyConflictError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import { EventRepositoryConfigurationError } from "./event-repository.js";
import type {
  CheckInAccessPassRequest,
  CheckInTicketRequest,
  CreateAccessPassIntentRequest,
  CreateAccessPassRequestRequest,
  CreateTicketIntentRequest,
  CreateTicketRequestRequest
} from "./types.js";
import {
  accessPassIntentResponse,
  conflictResponse,
  hashJson,
  notFoundResponse,
  type RegisterEventRoutesOptions,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  toAccessPass,
  toAccessPassRequest,
  validationResponse,
  verifyEventAccess
} from "./event-route-shared.js";

const paymentIntentTtlMs = 15 * 60 * 1000;

type AccessPassIntentBody = Partial<CreateAccessPassIntentRequest & CreateTicketIntentRequest>;
type AccessPassRequestBody = Partial<CreateAccessPassRequestRequest & CreateTicketRequestRequest>;

export async function registerEventAccessPassRoutes(
  app: FastifyInstance,
  options: RegisterEventRoutesOptions
): Promise<void> {
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

function getAccessPassTypeId(body: AccessPassIntentBody | AccessPassRequestBody | undefined): string | null {
  return body?.accessPassTypeId ?? body?.ticketTypeId ?? null;
}
