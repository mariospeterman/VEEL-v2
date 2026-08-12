import type { FastifyInstance } from "fastify";
import { ContentRepositoryConfigurationError } from "../content/content-repository.js";
import type { ContentUnlockIntent } from "../content/types.js";
import {
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository.js";
import { assertSolanaAddress, createSolanaReferenceAddress, SolanaPaymentConfigurationError } from "./solana-payment.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import { hashPaymentIntentRequest, notFoundResponse, paymentIntentTtlMs, toPaymentIntentResponse, validationResponse, verifyPaymentReadyAccess } from "./payment-route-shared.js";

export async function registerContentUnlockPaymentRoutes(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  app.post("/v1/content/:contentId/unlock-intents", async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const params = request.params as { contentId?: string };

    if (typeof params.contentId !== "string" || params.contentId.length === 0) {
      return reply.code(400).send(validationResponse("contentId is required"));
    }

    const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;

    if (!platformFeeWallet) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Payment platform fee wallet is not configured"
      });
    }

    try {
      assertSolanaAddress(platformFeeWallet);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);

      const offer = await options.contentRepository.findContentUnlockOffer({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId
      });

      if (!offer) {
        return reply.code(404).send(notFoundResponse("Content unlock offer was not found"));
      }

      if (offer.alreadyUnlocked) {
        return reply.code(201).send({
          state: "already_unlocked",
          contentId: offer.contentId,
          ...(offer.entitlement ? { entitlement: offer.entitlement } : {})
        } satisfies ContentUnlockIntent);
      }

      const intentBody = {
        productType: "content_unlock" as const,
        targetId: offer.contentId,
        amountMinor: offer.priceMinor
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashPaymentIntentRequest(intentBody),
        productType: intentBody.productType,
        targetId: intentBody.targetId,
        amountMinor: intentBody.amountMinor,
        currency: offer.currency,
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

      return reply.code(201).send({
        state: "payment_required",
        contentId: offer.contentId,
        paymentIntent: toPaymentIntentResponse(intent)
      } satisfies ContentUnlockIntent);
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Idempotency key was already used for a different content unlock intent"
        });
      }

      if (error instanceof PaymentRecipientNotReadyError) {
        return reply.code(409).send({
          code: "conflict",
          message: "This creator cannot receive payments yet"
        });
      }

      if (
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof ContentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Content unlock intent failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content unlock payments are not configured"
        });
      }

      throw error;
    }
  });

}
