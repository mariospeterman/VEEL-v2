import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import { toPaymentIntentResponse } from "../payment/payment-route-shared.js";
import { EventRepositoryConfigurationError } from "./event-repository.js";
import type {
  CheckInAccessPassRequest,
  CreateAccessPassIntentRequest,
  CreateAccessPassRequestRequest
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

type AccessPassIntentBody = Partial<CreateAccessPassIntentRequest>;
type AccessPassRequestBody = Partial<CreateAccessPassRequestRequest>;

export async function registerEventAccessPassRoutes(
  app: FastifyInstance,
  options: RegisterEventRoutesOptions
): Promise<void> {
  const createAccessPassIntent = async (
    request: FastifyRequest,
    reply: FastifyReply
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
      const offer = await options.eventRepository.findAccessPassOffer({
        supabaseUserId: access.supabaseUserId,
        eventId,
        accessPassTypeId: accessPassTypeId
      });

      if (!offer) {
        return reply.code(404).send(notFoundResponse("Access Pass offer was not found"));
      }

      if (offer.alreadyIssuedAccessPass) {
        return reply
          .code(201)
          .send(accessPassIntentResponse("free_granted", offer.alreadyIssuedAccessPass));
      }

      if (offer.event.accessRule === "private_apply") {
        return reply.code(201).send({ state: "approval_required" });
      }

      if (!offer.accessPassType.priceMinor || offer.accessPassType.priceMinor <= 0) {
        const accessPass = await options.eventRepository.grantFreeAccessPass({
          supabaseUserId: access.supabaseUserId,
          eventId,
          accessPassTypeId: accessPassTypeId
        });

        if (!accessPass) {
          return reply.code(409).send(conflictResponse("Access Pass inventory is no longer available"));
        }

        return reply.code(201).send(accessPassIntentResponse("free_granted", accessPass));
      }

      const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;

      if (!platformFeeWallet) {
        return reply.code(503).send(serviceUnavailableResponse("Payment platform fee wallet is not configured"));
      }

      assertSolanaAddress(platformFeeWallet);

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
        amountMinor: offer.accessPassType.priceMinor
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(intentBody),
        productType: "event_access_pass",
        targetId: eventId,
        amountMinor: offer.accessPassType.priceMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET ?? platformFeeWallet,
        platformFeeWallet,
        platformFeeBps: app.config.PAYMENT_PLATFORM_FEE_BPS,
        referralShareOfPlatformFeeBps: app.config.PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS,
        settlementKind: "creator_split",
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.eventRepository.recordAccessPassPurchaseRequest({
        supabaseUserId: access.supabaseUserId,
        eventId,
        accessPassTypeId: accessPassTypeId,
        paymentIntentId: intent.id,
        amountMinor: offer.accessPassType.priceMinor,
        currency: "SOL"
      });

      return reply.code(201).send({
        state: "payment_required",
        paymentIntent: toPaymentIntentResponse(intent)
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof PaymentRecipientNotReadyError) {
        return reply.code(409).send(conflictResponse("This creator cannot receive payments yet"));
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
    reply: FastifyReply
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
      const offer = await options.eventRepository.findAccessPassOffer({
        supabaseUserId: access.supabaseUserId,
        eventId,
        accessPassTypeId: accessPassTypeId
      });

      if (!offer || offer.event.accessRule !== "private_apply") {
        return reply.code(404).send(notFoundResponse("Private Access Pass offer was not found"));
      }

      const accessPassRequest = await options.eventRepository.createAccessPassRequest({
        supabaseUserId: access.supabaseUserId,
        eventId,
        accessPassTypeId: accessPassTypeId,
        note: note?.trim() || null
      });

      if (!accessPassRequest) {
        return reply.code(404).send(notFoundResponse("Private Access Pass offer was not found"));
      }

      return reply.code(201).send(toAccessPassRequest(accessPassRequest));
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
    reply: FastifyReply
  ) => {
    const access = await verifyEventAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CheckInAccessPassRequest> | undefined;

    if (!body?.qrToken) {
      return reply.code(400).send(validationResponse("qrToken is required"));
    }

    const params = request.params as { accessPassId?: string };
    const accessPassId = params.accessPassId ?? "";

    try {
      const accessPass = await options.eventRepository.checkInAccessPass({
        supabaseUserId: access.supabaseUserId,
        accessPassId,
        qrToken: body.qrToken
      });

      if (!accessPass) {
        return reply.code(404).send(notFoundResponse("Access Pass was not found"));
      }

      return reply.code(200).send(toAccessPass(accessPass));
    } catch (error) {
      if (error instanceof EventRepositoryConfigurationError) {
        request.log.warn({ error }, "Access Pass check-in failed");
        return reply.code(503).send(serviceUnavailableResponse("Access Pass check-in is not configured"));
      }

      throw error;
    }
  };

  app.post("/v1/events/:eventId/access-passes/intents", createAccessPassIntent);
  app.post("/v1/events/:eventId/access-passes/requests", requestAccessPass);
  app.post("/v1/access-passes/:accessPassId/check-in", checkInAccessPass);
}

function getAccessPassTypeId(body: AccessPassIntentBody | AccessPassRequestBody | undefined): string | null {
  return body?.accessPassTypeId ?? null;
}
