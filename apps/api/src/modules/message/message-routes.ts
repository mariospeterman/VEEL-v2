import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
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
import {
  conflictResponse,
  hashMessageBody,
  hashMessageActionRequest,
  hashPaymentRequest,
  notFoundResponse,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  type RegisterMessageRoutesOptions,
  validationResponse,
  validateMessageBody,
  verifyMessageReadyAccess
} from "./message-route-utils.js";
import {
  MessageBlockedError,
  MessageIdempotencyConflictError,
  MessageRequestForbiddenError,
  MessageRequestLimitError,
  MessageRepositoryConfigurationError
} from "./message-repository.js";
import type {
  CreateDirectConversationRequest,
  CreateMessageRequest,
  CreatePaidMessageIntentRequest,
  RespondToMessageRequest
} from "./types.js";

const paymentIntentTtlMs = 15 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  app.post("/v1/messages/conversations", mutationRateLimit("messageMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const body = request.body as Partial<CreateDirectConversationRequest> | undefined;
    if (!body || typeof body.targetUserId !== "string" || !uuidPattern.test(body.targetUserId)) {
      return reply.code(400).send(validationResponse("targetUserId must be a valid UUID"));
    }

    try {
      const conversation = await options.messageRepository.createDirectConversation({
        supabaseUserId: access.supabaseUserId,
        targetUserId: body.targetUserId,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ targetUserId: body.targetUserId })
      });
      if (!conversation) return reply.code(404).send(notFoundResponse("User was not found"));
      return reply.code(201).send(conversation);
    } catch (error) {
      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;
      throw error;
    }
  });

  app.patch("/v1/messages/conversations/:conversationId/request", mutationRateLimit("messageMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";
    const body = request.body as Partial<RespondToMessageRequest> | undefined;
    if (!uuidPattern.test(conversationId) || (body?.action !== "accept" && body?.action !== "decline")) {
      return reply.code(400).send(validationResponse("A valid conversation and request action are required"));
    }

    try {
      const conversation = await options.messageRepository.respondToMessageRequest({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        action: body.action,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ conversationId, action: body.action })
      });
      if (!conversation) return reply.code(404).send(notFoundResponse("Conversation was not found"));
      return reply.code(200).send(conversation);
    } catch (error) {
      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;
      throw error;
    }
  });

  app.patch("/v1/messages/conversations/:conversationId/read", mutationRateLimit("messageMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }
    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";
    if (!uuidPattern.test(conversationId)) {
      return reply.code(400).send(validationResponse("conversationId must be a valid UUID"));
    }

    try {
      const readState = await options.messageRepository.markConversationRead({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ conversationId })
      });
      if (!readState) return reply.code(404).send(notFoundResponse("Conversation was not found"));
      return reply.code(200).send(readState);
    } catch (error) {
      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;
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

  app.post("/v1/messages/conversations/:conversationId/messages", mutationRateLimit("messageMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
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
        body: body?.body?.trim() ?? "",
        idempotencyKey
      });

      if (!message) {
        return reply.code(404).send(notFoundResponse("Conversation was not found"));
      }

      return reply.code(201).send(message);
    } catch (error) {
      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;

      throw error;
    }
  });

  app.post("/v1/messages/conversations/:conversationId/paid-message-intents", mutationRateLimit("paymentMutation"), async (request, reply) => {
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

    const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;

    if (!platformFeeWallet) {
      return reply.code(503).send(serviceUnavailableResponse("Payment platform fee wallet is not configured"));
    }

    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";

    try {
      assertSolanaAddress(platformFeeWallet);
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
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET ?? platformFeeWallet,
        platformFeeWallet,
        platformFeeBps: app.config.PAYMENT_PLATFORM_FEE_BPS,
        referralShareOfPlatformFeeBps: app.config.PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS,
        settlementKind: "creator_split",
        creatorUserId: price.recipientUserId,
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
          ...toPaymentIntentResponse(intent),
          targetId: intent.targetId,
          referenceAddress: intent.referenceAddress,
          expiresAt: intent.expiresAt.toISOString()
        }
      });
    } catch (error) {
      if (error instanceof PaymentIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof PaymentRecipientNotReadyError) {
        return reply.code(409).send(conflictResponse("This creator cannot receive payments yet"));
      }

      if (
        error instanceof MessageRepositoryConfigurationError ||
        error instanceof PaymentRepositoryConfigurationError ||
        error instanceof SolanaPaymentConfigurationError
      ) {
        request.log.warn({ error }, "Paid message intent failed");
        return reply.code(503).send(serviceUnavailableResponse("Paid messages are not configured"));
      }

      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;

      throw error;
    }
  });
}

function messageMutationErrorReply(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof MessageIdempotencyConflictError) {
    return reply.code(409).send(conflictResponse("Idempotency key was already used"));
  }
  if (error instanceof MessageBlockedError) {
    return reply.code(403).send({ code: "forbidden", message: "Messaging is unavailable for this relationship" });
  }
  if (error instanceof MessageRequestForbiddenError) {
    return reply.code(403).send({ code: "forbidden", message: "This message request does not allow that action" });
  }
  if (error instanceof MessageRequestLimitError) {
    return reply.code(409).send(conflictResponse("The recipient must accept this request before more messages can be sent"));
  }
  if (error instanceof MessageRepositoryConfigurationError) {
    request.log.warn({ error }, "Message mutation failed");
    return reply.code(503).send(serviceUnavailableResponse("Messages are not configured"));
  }
  return null;
}
