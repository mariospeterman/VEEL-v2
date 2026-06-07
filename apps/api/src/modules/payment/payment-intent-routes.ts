import type { FastifyInstance } from "fastify";
import { PaymentIdempotencyConflictError, PaymentRepositoryConfigurationError } from "./payment-repository.js";
import { assertSolanaAddress, buildSolanaPayTransferRequestUrl, createSolanaReferenceAddress, SolanaPaymentConfigurationError } from "./solana-payment.js";
import type { CreatePaymentIntentRequest, SubmitPaymentSignatureRequest } from "./types.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import { hashPaymentIntentRequest, notFoundResponse, paymentIntentTtlMs, toPaymentIntentResponse, validateCreatePaymentIntentRequest, validationResponse, verifyPaymentReadyAccess } from "./payment-route-shared.js";

export async function registerPaymentIntentRoutes(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  app.post("/v1/payments/intents", async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreatePaymentIntentRequest> | undefined;
    const validationError = validateCreatePaymentIntentRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    if (body?.productType === "content_unlock") {
      return reply
        .code(400)
        .send(validationResponse("Use /v1/content/{contentId}/unlock-intents for content unlocks"));
    }

    if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Payment treasury wallet is not configured"
      });
    }

    try {
      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const intentBody = body as CreatePaymentIntentRequest & { amountMinor: number };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashPaymentIntentRequest(intentBody),
        productType: intentBody.productType,
        targetId: intentBody.targetId,
        amountMinor: intentBody.amountMinor,
        currency: "SOL",
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: intentBody.referralToken ?? null
      });

      return reply.code(201).send(toPaymentIntentResponse(intent));
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Idempotency key was already used for a different payment intent"
        });
      }

      if (
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Payment intent storage or treasury is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payments are not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/payments/intents/:paymentIntentId", async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const params = request.params as { paymentIntentId?: string };

    try {
      const intent = await options.paymentRepository.findIntent({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: params.paymentIntentId ?? ""
      });

      if (!intent) {
        return reply.code(404).send(notFoundResponse("Payment intent was not found"));
      }

      return reply.code(200).send(toPaymentIntentResponse(intent));
    } catch (error) {
      if (error instanceof PaymentRepositoryConfigurationError) {
        request.log.warn({ error }, "Payment repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payments are not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/payments/intents/:paymentIntentId/transaction-request", async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const params = request.params as { paymentIntentId?: string };

    try {
      const intent = await options.paymentRepository.findIntent({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: params.paymentIntentId ?? ""
      });

      if (!intent) {
        return reply.code(404).send(notFoundResponse("Payment intent was not found"));
      }

      const transactionRequestUrl = buildSolanaPayTransferRequestUrl({
        intent,
        label: "Veel"
      });
      const transactionRequest = await options.paymentRepository.recordTransactionRequest({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: intent.id,
        transactionRequestUrl
      });

      if (!transactionRequest) {
        return reply.code(404).send(notFoundResponse("Payment intent was not found"));
      }

      return reply.code(200).send(transactionRequest);
    } catch (error) {
      if (
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Payment transaction request failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payments are not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/payments/intents/:paymentIntentId/submissions", async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<SubmitPaymentSignatureRequest> | undefined;

    if (!body || typeof body.signature !== "string" || body.signature.length === 0) {
      return reply.code(400).send(validationResponse("signature is required"));
    }

    const params = request.params as { paymentIntentId?: string };

    try {
      const intent = await options.paymentRepository.findIntent({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: params.paymentIntentId ?? ""
      });

      if (!intent) {
        return reply.code(404).send(notFoundResponse("Payment intent was not found"));
      }

      const settlement = await options.settlementVerifier.verifyNativeSolTransfer({
        signature: body.signature,
        referenceAddress: intent.referenceAddress,
        treasuryWallet: intent.treasuryWallet,
        amountMinor: intent.amountMinor
      });

      await options.paymentRepository.recordSubmission({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: intent.id,
        signature: body.signature,
        settlement
      });

      return reply.code(202).send();
    } catch (error) {
      if (error instanceof PaymentRepositoryConfigurationError) {
        request.log.warn({ error }, "Payment submission failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payments are not configured"
        });
      }

      throw error;
    }
  });

}
