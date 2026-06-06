import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import { assertSolanaAddress, SolanaPaymentConfigurationError } from "../payment/solana-payment.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import {
  SubscriptionIdempotencyConflictError,
  SubscriptionPolicyError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-repository.js";
import type {
  CreateSubscriptionIntentRequest,
  SubmitSubscriptionAuthorizationRequest,
  SubscriptionAuthorizationVerifier,
  SubscriptionRepository
} from "./types.js";

interface RegisterSubscriptionRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  subscriptionRepository: SubscriptionRepository;
  subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier;
}

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
      if (app.config.SOLANA_SUBSCRIPTION_COLLECTOR_WALLET) {
        assertSolanaAddress(app.config.SOLANA_SUBSCRIPTION_COLLECTOR_WALLET);
      }

      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);

      const intentBody = body as CreateSubscriptionIntentRequest;
      const intent = await options.subscriptionRepository.createAuthorizationIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(intentBody),
        body: intentBody,
        expiresAt: new Date(Date.now() + authorizationIntentTtlMs),
        collectorAddress: app.config.SOLANA_SUBSCRIPTION_COLLECTOR_WALLET ?? null,
        delegationProgramId: app.config.SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID
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
      const verificationContext =
        await options.subscriptionRepository.findAuthorizationVerificationContext({
          supabaseUserId: access.supabaseUserId,
          authorizationIntentId,
          delegationProgramId: app.config.SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID
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
        tokenMint: verificationContext.tokenMint,
        tokenProgram: verificationContext.tokenProgram,
        amountMinor: verificationContext.amountMinor,
        periodDays: verificationContext.periodDays
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

type SubscriptionReadyAccessResult =
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

async function verifySubscriptionReadyAccess(
  request: FastifyRequest,
  options: RegisterSubscriptionRoutesOptions
): Promise<SubscriptionReadyAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const profile = await options.sessionRepository.findProfileBySupabaseUserId(
    verifiedSession.supabaseUserId
  );
  const [ageStatus, hasWallet] = await Promise.all([
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Subscriptions require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function validateCreateSubscriptionIntent(
  body: Partial<CreateSubscriptionIntentRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.planId !== "string" || body.planId.length === 0) {
    return "planId is required";
  }

  if (
    body.creatorUserId !== undefined &&
    (typeof body.creatorUserId !== "string" || body.creatorUserId.length === 0)
  ) {
    return "creatorUserId must be a non-empty string when provided";
  }

  return null;
}

function validateSubmitSubscriptionAuthorization(
  body: Partial<SubmitSubscriptionAuthorizationRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  for (const field of ["signature", "authorityAddress", "delegationAddress", "subscriberTokenAccount"] as const) {
    if (typeof body[field] !== "string" || body[field].length === 0) {
      return `${field} is required`;
    }
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

function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}

function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}
