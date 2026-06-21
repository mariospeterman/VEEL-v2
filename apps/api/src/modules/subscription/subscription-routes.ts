import type { FastifyInstance } from "fastify";
import { assertSolanaAddress, SolanaPaymentConfigurationError } from "../payment/solana-payment.js";
import {
  conflictResponse,
  hashJson,
  notFoundResponse,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  type RegisterSubscriptionRoutesOptions,
  validationResponse,
  validateCreateSubscriptionIntent,
  validateSubmitSubscriptionAuthorization,
  verifySubscriptionReadyAccess
} from "./subscription-route-utils.js";
import {
  SubscriptionIdempotencyConflictError,
  SubscriptionPolicyError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-repository.js";
import {
  checkSubscriptionProviderReadiness,
  getSubscriptionProviderConfig
} from "./subscription-provider-config.js";
import type {
  CreateSubscriptionIntentRequest,
  SubmitSubscriptionAuthorizationRequest
} from "./types.js";

const authorizationIntentTtlMs = 15 * 60 * 1000;

export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: RegisterSubscriptionRoutesOptions
): Promise<void> {
  app.get("/v1/subscriptions/plans", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    try {
      const page = await options.subscriptionRepository.listPlans({
        supabaseUserId: access.supabaseUserId
      });

      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Subscription plan lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/subscriptions", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    try {
      const page = await options.subscriptionRepository.listSubscriptions({
        supabaseUserId: access.supabaseUserId
      });

      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Subscription list lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/subscriptions/intents", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateSubscriptionIntentRequest> | undefined;
    const validationError = validateCreateSubscriptionIntent(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const readiness = checkSubscriptionProviderReadiness(app.config);
      if (!readiness.ok) {
        return reply
          .code(503)
          .send(serviceUnavailableResponse(`Subscriptions are unavailable: ${readiness.reason}`));
      }

      if (readiness.config.collectorWallet) {
        assertSolanaAddress(readiness.config.collectorWallet);
      }

      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);

      const intentBody = body as CreateSubscriptionIntentRequest;
      const intent = await options.subscriptionRepository.createAuthorizationIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(intentBody),
        body: intentBody,
        expiresAt: new Date(Date.now() + authorizationIntentTtlMs),
        collectorAddress: readiness.config.collectorWallet,
        delegationProgramId: readiness.config.programId,
        provider: readiness.config.provider,
        supportedMints: readiness.config.supportedMints
      });

      return reply.code(201).send(intent);
    } catch (error) {
      if (error instanceof SubscriptionIdempotencyConflictError) {
        return reply
          .code(409)
          .send(conflictResponse("Idempotency key was already used for a different subscription intent"));
      }

      if (error instanceof SubscriptionPolicyError) {
        const statusCode = error.message === "subscription_plan_not_found" ? 404 : 400;
        return reply.code(statusCode).send(validationResponse(error.message));
      }

      if (
        error instanceof SubscriptionRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Subscription intent creation failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/subscriptions/authorizations/:authorizationIntentId/submissions", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<SubmitSubscriptionAuthorizationRequest> | undefined;
    const validationError = validateSubmitSubscriptionAuthorization(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const authorizationIntentId =
      (request.params as { authorizationIntentId?: string }).authorizationIntentId ?? "";
    const submitBody = body as SubmitSubscriptionAuthorizationRequest;

    try {
      const providerConfig = getSubscriptionProviderConfig(app.config);
      const verificationContext =
        await options.subscriptionRepository.findAuthorizationVerificationContext({
          supabaseUserId: access.supabaseUserId,
          authorizationIntentId,
          delegationProgramId: providerConfig.programId
        });

      if (!verificationContext) {
        return reply.code(404).send(notFoundResponse("Subscription authorization intent was not found"));
      }

      const verification = await options.subscriptionAuthorizationVerifier.verifyAuthorization({
        signature: submitBody.signature,
        setupReference: verificationContext.setupReference,
        authorityAddress: submitBody.authorityAddress,
        delegationAddress: submitBody.delegationAddress,
        subscriberTokenAccount: submitBody.subscriberTokenAccount,
        delegationProgramId: verificationContext.delegationProgramId,
        collectorAddress: verificationContext.collectorAddress,
        subscriberWallet: verificationContext.subscriberWallet,
        tokenMint: verificationContext.tokenMint,
        tokenProgram: verificationContext.tokenProgram,
        amountMinor: verificationContext.amountMinor,
        periodDays: verificationContext.periodDays,
        provider: verificationContext.provider,
        planId: verificationContext.planId,
        planPda: verificationContext.planPda,
        subscriptionPda: verificationContext.subscriptionPda,
        merchantWallet: verificationContext.merchantWallet,
        expiresAt: verificationContext.expiresAt
      });
      const subscription = await options.subscriptionRepository.submitAuthorization({
        supabaseUserId: access.supabaseUserId,
        authorizationIntentId,
        idempotencyKey,
        body: submitBody,
        verification
      });

      if (!subscription) {
        return reply.code(404).send(notFoundResponse("Subscription authorization intent was not found"));
      }

      return reply.code(202).send(subscription);
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Subscription authorization submission failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });

  app.patch("/v1/subscriptions/:subscriptionId/cancel", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const subscriptionId = (request.params as { subscriptionId?: string }).subscriptionId ?? "";

    try {
      const subscription = await options.subscriptionRepository.cancel({
        supabaseUserId: access.supabaseUserId,
        subscriptionId,
        idempotencyKey
      });

      if (!subscription) {
        return reply.code(404).send(notFoundResponse("Subscription was not found"));
      }

      return reply.code(200).send(subscription);
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Subscription cancellation failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });
}
