import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
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
import { MessageRepositoryConfigurationError } from "./message-repository.js";
import type {
  CreateMessageRequest,
  CreatePaidMessageIntentRequest,
  MessageRepository
} from "./types.js";

interface RegisterMessageRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  paymentRepository: PaymentRepository;
  messageRepository: MessageRepository;
}

const paymentIntentTtlMs = 15 * 60 * 1000;

export async function registerMessageRoutes(
  app: FastifyInstance,
  options: RegisterMessageRoutesOptions
): Promise<void> {
  app.get("/v1/messages/conversations", async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    try {
      return reply.code(200).send(
        await options.messageRepository.listConversations({
          supabaseUserId: access.supabaseUserId
        })
      );
    } catch (error) {
      if (error instanceof MessageRepositoryConfigurationError) {
        request.log.warn({ error }, "Message conversation list failed");
        return reply.code(503).send(serviceUnavailableResponse("Messages are not configured"));
      }

      throw error;
    }
  });

  app.get("/v1/messages/conversations/:conversationId/messages", async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";

    try {
      const page = await options.messageRepository.listMessages({
        supabaseUserId: access.supabaseUserId,
        conversationId
      });

      if (!page) {
        return reply.code(404).send(notFoundResponse("Conversation was not found"));
      }

      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof MessageRepositoryConfigurationError) {
        request.log.warn({ error }, "Message list failed");
        return reply.code(503).send(serviceUnavailableResponse("Messages are not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/messages/conversations/:conversationId/messages", async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateMessageRequest> | undefined;
    const validationError = validateMessageBody(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    if (body?.paidMessageIntentId) {
      return reply
        .code(400)
        .send(validationResponse("Use paid-message-intents for paid message delivery"));
    }

    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";

    try {
      const message = await options.messageRepository.createMessage({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        body: body?.body?.trim() ?? ""
      });

      if (!message) {
        return reply.code(404).send(notFoundResponse("Conversation was not found"));
      }

      return reply.code(201).send(message);
    } catch (error) {
      if (error instanceof MessageRepositoryConfigurationError) {
        request.log.warn({ error }, "Message create failed");
        return reply.code(503).send(serviceUnavailableResponse("Messages are not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/messages/conversations/:conversationId/paid-message-intents", async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreatePaidMessageIntentRequest> | undefined;
    const validationError = validateMessageBody(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
      return reply.code(503).send(serviceUnavailableResponse("Payment treasury wallet is not configured"));
    }

    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";

    try {
      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const price = await options.messageRepository.findConversationPrice({
        supabaseUserId: access.supabaseUserId,
        conversationId
      });

      if (!price) {
        return reply.code(404).send(notFoundResponse("Conversation was not found"));
      }

      const intentBody = {
        productType: "paid_message" as const,
        targetId: conversationId,
        amountMinor: price.amountMinor,
        bodyHash: hashMessageBody(body?.body?.trim() ?? "")
      };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashPaymentRequest(intentBody),
        productType: "paid_message",
        targetId: conversationId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
        referenceAddress: createSolanaReferenceAddress(),
        expiresAt: new Date(Date.now() + paymentIntentTtlMs),
        referralToken: null
      });

      await options.messageRepository.recordPaidMessageDraft({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        paymentIntentId: intent.id,
        body: body?.body?.trim() ?? "",
        amountMinor: price.amountMinor,
        currency: price.currency
      });

      return reply.code(201).send({
        state: "payment_required",
        conversationId,
        paymentIntent: {
          id: intent.id,
          productType: intent.productType,
          targetId: intent.targetId,
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          state: intent.state,
          referenceAddress: intent.referenceAddress,
          expiresAt: intent.expiresAt.toISOString()
        }
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (
        error instanceof MessageRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Paid message intent failed");
        return reply.code(503).send(serviceUnavailableResponse("Paid messages are not configured"));
      }

      throw error;
    }
  });
}

type MessageReadyAccessResult =
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

async function verifyMessageReadyAccess(
  request: FastifyRequest,
  options: Pick<
    RegisterMessageRoutesOptions,
    "authVerifier" | "sessionRepository" | "ageRepository" | "walletRepository"
  >
): Promise<MessageReadyAccessResult> {
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
        message: "Messages require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];

  return typeof idempotencyKey === "string" && idempotencyKey.length > 0
    ? idempotencyKey
    : null;
}

function validateMessageBody(
  body: Partial<CreateMessageRequest | CreatePaidMessageIntentRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.body !== "string" || body.body.trim().length === 0) {
    return "body is required";
  }

  if (body.body.length > 4000) {
    return "body must be 4000 characters or fewer";
  }

  return null;
}

function hashPaymentRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashMessageBody(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validationResponse(message: string) {
  return { code: "validation_failed", message };
}

function conflictResponse(message: string) {
  return { code: "conflict", message };
}

function notFoundResponse(message: string) {
  return { code: "not_found", message };
}

function serviceUnavailableResponse(message: string) {
  return { code: "service_unavailable", message };
}
