import type { FastifyInstance } from "fastify";
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
import { LiveRepositoryConfigurationError } from "./live-repository.js";
import {
  conflictResponse,
  hashLiveRequest,
  notFoundResponse,
  type RegisterLiveRoutesOptions,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  validationResponse,
  verifyLiveReadyAccess
} from "./live-route-shared.js";

const paymentIntentTtlMs = 15 * 60 * 1000;
export async function registerLivePassRoutes(
  app: FastifyInstance,
  options: RegisterLiveRoutesOptions
): Promise<void> {
  app.post("/v1/live/rooms/:roomId/event-access-intents", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;

    if (!platformFeeWallet) {
      return reply
        .code(503)
        .send(serviceUnavailableResponse("Payment platform fee wallet is not configured"));
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      assertSolanaAddress(platformFeeWallet);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const room = await options.liveRepository.findRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      if (room.accessMode !== "paid_event" || !room.eventAccess) {
        return reply.code(400).send(validationResponse("Live room is not a paid event"));
      }

      if (room.accessState === "allowed") {
        return reply.code(409).send(conflictResponse("Live event access is already active"));
      }

      const intentBody = {
        productType: "live_pass" as const,
        targetId: room.id,
        amountMinor: room.eventAccess.amountMinor
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashLiveRequest(intentBody),
        productType: "live_pass",
        targetId: room.id,
        amountMinor: room.eventAccess.amountMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET ?? platformFeeWallet,
        platformFeeWallet,
        platformFeeBps: app.config.PAYMENT_PLATFORM_FEE_BPS,
        referralShareOfPlatformFeeBps: app.config.PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS,
        settlementKind: "creator_split",
        creatorUserId: room.creator.id,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.liveRepository.recordLivePassPurchaseRequest({
        supabaseUserId: access.supabaseUserId,
        roomId: room.id,
        paymentIntentId: intent.id,
        amountMinor: room.eventAccess.amountMinor,
        currency: "SOL"
      });

      return reply.code(201).send({
        ...toPaymentIntentResponse(intent),
        targetId: intent.targetId,
        referenceAddress: intent.referenceAddress,
        expiresAt: intent.expiresAt.toISOString()
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof PaymentRecipientNotReadyError) {
        return reply.code(409).send(conflictResponse("This creator cannot receive payments yet"));
      }

      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Live event access intent failed");
        return reply
          .code(503)
          .send(serviceUnavailableResponse("Live event access payments are not configured"));
      }

      throw error;
    }
  });
}
