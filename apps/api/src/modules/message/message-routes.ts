import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import {
  conflictResponse,
  hashMessageActionRequest,
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
  RespondToMessageRequest,
  UpdateConversationMuteRequest
} from "./types.js";
import { registerMessageCommercialRoutes } from "./message-commercial-routes.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reactionKeys = new Set(["like", "love", "laugh", "support"] as const);

export async function registerMessageRoutes(
  app: FastifyInstance,
  options: RegisterMessageRoutesOptions
): Promise<void> {
  await registerMessageCommercialRoutes(app, options);
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

  app.patch("/v1/messages/conversations/:conversationId/mute", mutationRateLimit("messageMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";
    const body = request.body as Partial<UpdateConversationMuteRequest> | undefined;
    if (!idempotencyKey || !uuidPattern.test(conversationId) || typeof body?.muted !== "boolean") {
      return reply.code(400).send(validationResponse("A valid conversation, muted flag, and Idempotency-Key are required"));
    }
    try {
      const conversation = await options.messageRepository.updateConversationMute({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        muted: body.muted,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ conversationId, muted: body.muted })
      });
      if (!conversation) return reply.code(404).send(notFoundResponse("Conversation was not found"));
      return reply.code(200).send(conversation);
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

    if (
      (body?.replyToMessageId != null && !uuidPattern.test(body.replyToMessageId)) ||
      (body?.sharedContentItemId != null && !uuidPattern.test(body.sharedContentItemId))
    ) {
      return reply.code(400).send(validationResponse("Reply and shared content references must be valid UUIDs"));
    }
    if (
      body?.attachmentContentItemIds !== undefined &&
      (!Array.isArray(body.attachmentContentItemIds) ||
        body.attachmentContentItemIds.length > 4 ||
        new Set(body.attachmentContentItemIds).size !== body.attachmentContentItemIds.length ||
        body.attachmentContentItemIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)))
    ) {
      return reply.code(400).send(validationResponse("Attachments must contain up to four unique content UUIDs"));
    }

    const conversationId = (request.params as { conversationId?: string }).conversationId ?? "";

    try {
      const message = await options.messageRepository.createMessage({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        body: body?.body?.trim() ?? "",
        idempotencyKey,
        replyToMessageId: body?.replyToMessageId ?? null,
        sharedContentItemId: body?.sharedContentItemId ?? null,
        attachmentContentItemIds: body?.attachmentContentItemIds ?? []
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

  const updateReaction = (reacted: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyKey = requiredIdempotencyKey(request);
    const params = request.params as { conversationId?: string; messageId?: string; reactionKey?: string };
    if (
      !idempotencyKey ||
      !uuidPattern.test(params.conversationId ?? "") ||
      !uuidPattern.test(params.messageId ?? "") ||
      !reactionKeys.has(params.reactionKey as "like" | "love" | "laugh" | "support")
    ) {
      return reply.code(400).send(validationResponse("A valid message reaction request is required"));
    }
    try {
      const message = await options.messageRepository.updateMessageReaction({
        supabaseUserId: access.supabaseUserId,
        conversationId: params.conversationId as string,
        messageId: params.messageId as string,
        reactionKey: params.reactionKey as "like" | "love" | "laugh" | "support",
        reacted
      });
      if (!message) return reply.code(404).send(notFoundResponse("Message was not found"));
      return reply.code(200).send(message);
    } catch (error) {
      const handled = messageMutationErrorReply(request, reply, error);
      if (handled) return handled;
      throw error;
    }
  };
  app.put(
    "/v1/messages/conversations/:conversationId/messages/:messageId/reactions/:reactionKey",
    mutationRateLimit("messageMutation"),
    updateReaction(true)
  );
  app.delete(
    "/v1/messages/conversations/:conversationId/messages/:messageId/reactions/:reactionKey",
    mutationRateLimit("messageMutation"),
    updateReaction(false)
  );

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
