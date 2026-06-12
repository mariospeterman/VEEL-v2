import type { FastifyInstance } from "fastify";
import {
  PaymentIdempotencyConflictError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import { toPaymentIntentResponse } from "../payment/payment-route-shared.js";
import { LiveRepositoryConfigurationError } from "./live-repository.js";
import type { CreateLivePassIntentRequest } from "./types.js";
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
const livePassDurations = new Set([30, 60, 180]);

export async function registerLivePassRoutes(
  app: FastifyInstance,
  options: RegisterLiveRoutesOptions
): Promise<void> {
  app.post("/v1/live/rooms/:roomId/pass-intents", async (request, reply) => {
    const access = await verifyLiveReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateLivePassIntentRequest> | undefined;

    if (!body || !livePassDurations.has(Number(body.durationMinutes))) {
      return reply.code(400).send(validationResponse("durationMinutes must be 30, 60, or 180"));
    }

    if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
      return reply
        .code(503)
        .send(serviceUnavailableResponse("Payment treasury wallet is not configured"));
    }

    const roomId = (request.params as { roomId?: string }).roomId ?? "";

    try {
      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const room = await options.liveRepository.findRoom({
        supabaseUserId: access.supabaseUserId,
        roomId
      });

      if (!room) {
        return reply.code(404).send(notFoundResponse("Live room was not found"));
      }

      const durationMinutes = body.durationMinutes as 30 | 60 | 180;
      const passOption = room.passOptions.find((option) => option.durationMinutes === durationMinutes);

      if (!passOption) {
        return reply.code(400).send(validationResponse("durationMinutes is not available"));
      }

      const intentBody = {
        productType: "live_pass" as const,
        targetId: room.id,
        amountMinor: passOption.amountMinor,
        durationMinutes
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashLiveRequest(intentBody),
        productType: "live_pass",
        targetId: room.id,
        amountMinor: passOption.amountMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.liveRepository.recordLivePassPurchaseRequest({
        supabaseUserId: access.supabaseUserId,
        roomId: room.id,
        paymentIntentId: intent.id,
        durationMinutes,
        amountMinor: passOption.amountMinor,
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

      if (
        error instanceof LiveRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Live pass intent failed");
        return reply
          .code(503)
          .send(serviceUnavailableResponse("Live pass payments are not configured"));
      }

      throw error;
    }
  });
}
