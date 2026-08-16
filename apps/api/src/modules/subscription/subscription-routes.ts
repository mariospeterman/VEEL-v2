import type { FastifyInstance } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { calculateSettlementSplit } from "../payment/payment-amounts.js";
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
  SubmitSubscriptionAuthorizationRequest,
  UpsertCreatorMembershipOfferRequest
} from "./types.js";
import { registerPlatformUsageRoutes } from "./platform-usage-routes.js";

const authorizationIntentTtlMs = 15 * 60 * 1000;

export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: RegisterSubscriptionRoutesOptions
): Promise<void> {
  await registerPlatformUsageRoutes(app, options);

  app.get("/v1/platform-access", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!options.subscriptionRepository.getPlatformAccess) {
      return reply.code(503).send(serviceUnavailableResponse("Platform access is not configured"));
    }

    try {
      return reply.code(200).send(await options.subscriptionRepository.getPlatformAccess({
        supabaseUserId: access.supabaseUserId
      }));
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Platform access lookup failed");
        return reply.code(503).send(serviceUnavailableResponse("Platform access is not configured"));
      }

      throw error;
    }
  });

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

  app.get("/v1/subscriptions/creator-offer", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    try {
      const offer = await options.subscriptionRepository.getCreatorOffer({
        supabaseUserId: access.supabaseUserId
      });
      return offer
        ? reply.code(200).send(offer)
        : reply.code(404).send(notFoundResponse("Membership offer was not found"));
    } catch (error) {
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        return reply.code(503).send(serviceUnavailableResponse("Membership offers are not configured"));
      }
      throw error;
    }
  });

  app.put(
    "/v1/subscriptions/creator-offer",
    mutationRateLimit("paymentMutation", "upsertMyCreatorMembershipOffer"),
    async (request, reply) => {
      const access = await verifySubscriptionReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      const body = request.body as Partial<UpsertCreatorMembershipOfferRequest> | undefined;
      const errorMessage = validateCreatorOffer(body);
      if (errorMessage) return reply.code(400).send(validationResponse(errorMessage));
      const tokenMint = app.config.SUBSCRIPTIONS_DEFAULT_MINT ?? app.config.SOLANA_SUBSCRIPTION_USDC_MINT;
      if (!tokenMint) return reply.code(503).send(serviceUnavailableResponse("USDC memberships are not configured"));
      try {
        const requestBody = body as UpsertCreatorMembershipOfferRequest;
        const atomicFactor = 10 ** Math.max(0, app.config.PAYMENT_USDC_DECIMALS - 2);
        const amountAtomic = requestBody.amountMinor * atomicFactor;
        const split = calculateSettlementSplit({
          totalAmountAtomic: amountAtomic,
          platformFeeBps: app.config.PAYMENT_PLATFORM_FEE_BPS
        });
        return reply.code(200).send(await options.subscriptionRepository.upsertCreatorOffer({
          supabaseUserId: access.supabaseUserId,
          idempotencyKey,
          requestHash: hashJson(requestBody),
          body: requestBody,
          tokenMint,
          programId: app.config.SUBSCRIPTIONS_SOLANA_PROGRAM_ID,
          amountAtomic,
          creatorAmountAtomic: split.creatorAmountAtomic,
          platformAmountAtomic: split.platformFeeAmountAtomic
        }));
      } catch (error) {
        if (error instanceof SubscriptionIdempotencyConflictError) {
          return reply.code(409).send(conflictResponse("Idempotency key was already used for another offer"));
        }
        if (error instanceof SubscriptionPolicyError) {
          return reply.code(409).send(conflictResponse("Complete earnings readiness before creating a membership"));
        }
        if (error instanceof SubscriptionRepositoryConfigurationError) {
          return reply.code(503).send(serviceUnavailableResponse("Membership offers are not configured"));
        }
        throw error;
      }
    }
  );

  app.delete(
    "/v1/subscriptions/creator-offer",
    mutationRateLimit("paymentMutation", "disableMyCreatorMembershipOffer"),
    async (request, reply) => {
      const access = await verifySubscriptionReadyAccess(request, options);
      if (!access.ok) return reply.code(access.statusCode).send(access.body);
      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      try {
        const disabled = await options.subscriptionRepository.disableCreatorOffer({
          supabaseUserId: access.supabaseUserId,
          idempotencyKey,
          requestHash: hashJson({ action: "disable" })
        });
        return disabled
          ? reply.code(204).send()
          : reply.code(404).send(notFoundResponse("Membership offer was not found"));
      } catch (error) {
        if (error instanceof SubscriptionIdempotencyConflictError) {
          return reply.code(409).send(conflictResponse("Idempotency key was already used for another offer action"));
        }
        if (error instanceof SubscriptionRepositoryConfigurationError) {
          return reply.code(503).send(serviceUnavailableResponse("Membership offers are not configured"));
        }
        throw error;
      }
    }
  );

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
        if (error.message.startsWith("recipient_")) {
          return reply.code(409).send(conflictResponse("This creator cannot receive subscriptions yet"));
        }
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

      if (
        !verificationContext.authorityAddress ||
        !verificationContext.delegationAddress ||
        !verificationContext.subscriberTokenAccount ||
        !verificationContext.delegationExpiresAt
      ) {
        return reply.code(400).send(validationResponse("Create the wallet authorization transaction first"));
      }

      const verification = await options.subscriptionAuthorizationVerifier.verifyAuthorization({
        signature: submitBody.signature,
        setupReference: verificationContext.setupReference,
        authorityAddress: verificationContext.authorityAddress,
        delegationAddress: verificationContext.delegationAddress,
        subscriberTokenAccount: verificationContext.subscriberTokenAccount,
        delegationProgramId: verificationContext.delegationProgramId,
        collectorAddress: verificationContext.collectorAddress,
        subscriberWallet: verificationContext.subscriberWallet,
        tokenMint: verificationContext.tokenMint,
        tokenProgram: verificationContext.tokenProgram,
        amountMinor: verificationContext.amountMinor,
        amountAtomic: verificationContext.amountAtomic,
        periodDays: verificationContext.periodDays,
        periodSeconds: verificationContext.periodSeconds,
        delegationExpiresAt: verificationContext.delegationExpiresAt,
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

  app.get("/v1/subscriptions/authorizations/:authorizationIntentId/transaction", async (request, reply) => {
    const access = await verifySubscriptionReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const authorizationIntentId =
      (request.params as { authorizationIntentId?: string }).authorizationIntentId ?? "";

    try {
      const readiness = checkSubscriptionProviderReadiness(app.config);
      if (!readiness.ok) {
        return reply
          .code(503)
          .send(serviceUnavailableResponse(`Subscriptions are unavailable: ${readiness.reason}`));
      }
      if (!readiness.config.rpcUrl) {
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are unavailable: rpc_unavailable"));
      }

      const context = await options.subscriptionRepository.findAuthorizationVerificationContext({
        supabaseUserId: access.supabaseUserId,
        authorizationIntentId,
        delegationProgramId: readiness.config.programId
      });
      if (!context) {
        return reply.code(404).send(notFoundResponse("Subscription authorization intent was not found"));
      }

      const transaction = await options.subscriptionAuthorizationTransactionBuilder({
        context,
        rpcUrl: readiness.config.rpcUrl
      });
      await options.subscriptionRepository.recordAuthorizationTransactionFacts({
        supabaseUserId: access.supabaseUserId,
        authorizationIntentId,
        authorityAddress: transaction.authorityAddress,
        delegationAddress: transaction.delegationAddress,
        subscriberTokenAccount: transaction.subscriberTokenAccount,
        delegationExpiresAt: new Date(transaction.delegationExpiresAt)
      });
      return reply.code(200).send(transaction);
    } catch (error) {
      request.log.warn({ error }, "Subscription authorization transaction failed");
      return reply.code(503).send(serviceUnavailableResponse("Wallet authorization is unavailable"));
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
        idempotencyKey,
        requestHash: hashJson({ subscriptionId })
      });

      if (!subscription) {
        return reply.code(404).send(notFoundResponse("Subscription was not found"));
      }

      return reply.code(200).send(subscription);
    } catch (error) {
      if (error instanceof SubscriptionIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used for another cancellation"));
      }
      if (error instanceof SubscriptionRepositoryConfigurationError) {
        request.log.warn({ error }, "Subscription cancellation failed");
        return reply.code(503).send(serviceUnavailableResponse("Subscriptions are not configured"));
      }

      throw error;
    }
  });
}

function validateCreatorOffer(
  body: Partial<UpsertCreatorMembershipOfferRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") return "Request body is required";
  if (typeof body.label !== "string" || body.label.trim().length < 2 || body.label.trim().length > 80) {
    return "label must contain 2 to 80 characters";
  }
  if (!Number.isInteger(body.amountMinor) || (body.amountMinor ?? 0) < 100 || (body.amountMinor ?? 0) > 100_000) {
    return "amountMinor must be between 100 and 100000";
  }
  if (body.description !== null && body.description !== undefined &&
      (typeof body.description !== "string" || body.description.length > 500)) {
    return "description must contain at most 500 characters";
  }
  if (!Array.isArray(body.benefits) || body.benefits.length > 8 ||
      body.benefits.some((benefit) => typeof benefit !== "string" || benefit.trim().length < 1 || benefit.length > 120)) {
    return "benefits must contain up to 8 short items";
  }
  return null;
}
