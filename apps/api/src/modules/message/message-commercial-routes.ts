import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import {
  PaymentAmountBelowPolicyError,
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "../payment/payment-repository.js";
import { defaultPaymentCommercialPolicy } from "../payment/payment-commercial-policy.js";
import { toPaymentIntentResponse } from "../payment/payment-route-shared.js";
import {
  assertSolanaAddress,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "../payment/solana-payment.js";
import {
  hashMessageActionRequest,
  requiredIdempotencyKey,
  type RegisterMessageRoutesOptions,
  validationResponse,
  verifyMessageReadyAccess
} from "./message-route-utils.js";
import {
  MessageBlockedError,
  MessageIdempotencyConflictError,
  MessageRequestForbiddenError,
  MessageRepositoryConfigurationError
} from "./message-repository.js";
import type {
  CreateCreatorMediaOfferRequest,
  CreateStructuredCreatorRequestRequest,
  UpdateCreatorMediaOfferRequest,
  UpdateStructuredCreatorRequestRequest
} from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permittedCategories = new Set(["photo", "video", "audio", "written", "other_safe"]);
const requestActions = new Set(["accept", "decline", "propose_terms", "accept_terms", "mark_delivered", "request_remediation", "complete", "cancel"]);
const prohibitedPersonalAccess = /\b(guaranteed\s+(reply|response|attention)|romantic\s+access|sexual\s+access|offline\s+(meet|meeting|access)|in[- ]person\s+(meet|meeting|access))\b/i;

export async function registerMessageCommercialRoutes(
  app: FastifyInstance,
  options: RegisterMessageRoutesOptions
) {
  app.get("/v1/messages/conversations/:conversationId/commercial-interactions", async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const conversationId = readConversationId(request);
    if (!conversationId) return reply.code(400).send(validationResponse("A valid conversation is required"));
    try {
      const result = await options.messageRepository.listCommercialInteractions({
        supabaseUserId: access.supabaseUserId,
        conversationId
      });
      return result
        ? reply.code(200).send(result)
        : reply.code(404).send({ code: "not_found", message: "Conversation was not found" });
    } catch (error) {
      return handleCommercialError(request, reply, error);
    }
  });

  app.post("/v1/messages/conversations/:conversationId/media-offers", mutationRateLimit("paymentMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const conversationId = readConversationId(request);
    const idempotencyKey = requiredIdempotencyKey(request);
    const body = request.body as Partial<CreateCreatorMediaOfferRequest> | undefined;
    const invalid = validateMediaOffer(body);
    if (!conversationId || !idempotencyKey || invalid) {
      return reply.code(400).send(validationResponse(invalid ?? "A valid conversation and Idempotency-Key are required"));
    }
    try {
      const response = await options.messageRepository.createCreatorMediaOffer({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        body: body as CreateCreatorMediaOfferRequest,
        idempotencyKey,
        requestHash: hashMessageActionRequest(body)
      });
      return response
        ? reply.code(201).send(response)
        : reply.code(404).send({ code: "not_found", message: "Conversation was not found" });
    } catch (error) {
      return handleCommercialError(request, reply, error);
    }
  });

  app.patch("/v1/messages/conversations/:conversationId/media-offers/:offerId", mutationRateLimit("paymentMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const { conversationId, resourceId: offerId } = readCommercialParams(request, "offerId");
    const idempotencyKey = requiredIdempotencyKey(request);
    const body = request.body as Partial<UpdateCreatorMediaOfferRequest> | undefined;
    if (!conversationId || !offerId || !idempotencyKey || (body?.action !== "decline" && body?.action !== "withdraw")) {
      return reply.code(400).send(validationResponse("A valid offer action and Idempotency-Key are required"));
    }
    try {
      const response = await options.messageRepository.updateCreatorMediaOffer({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        offerId,
        action: body.action,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ offerId, action: body.action })
      });
      return response
        ? reply.code(200).send(response)
        : reply.code(404).send({ code: "not_found", message: "Offer was not found" });
    } catch (error) {
      return handleCommercialError(request, reply, error);
    }
  });

  app.post("/v1/messages/conversations/:conversationId/media-offers/:offerId/payment-intents", mutationRateLimit("paymentMutation"), async (request, reply) => {
    return createCommercialPaymentIntent(app, options, request, reply, "media_offer");
  });

  app.post("/v1/messages/conversations/:conversationId/creator-requests", mutationRateLimit("paymentMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const conversationId = readConversationId(request);
    const idempotencyKey = requiredIdempotencyKey(request);
    const body = request.body as Partial<CreateStructuredCreatorRequestRequest> | undefined;
    const invalid = validateCreatorRequest(body);
    if (!conversationId || !idempotencyKey || invalid) {
      return reply.code(400).send(validationResponse(invalid ?? "A valid conversation and Idempotency-Key are required"));
    }
    try {
      const response = await options.messageRepository.createStructuredCreatorRequest({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        body: body as CreateStructuredCreatorRequestRequest,
        idempotencyKey,
        requestHash: hashMessageActionRequest(body)
      });
      return response
        ? reply.code(201).send(response)
        : reply.code(404).send({ code: "not_found", message: "Conversation was not found" });
    } catch (error) {
      return handleCommercialError(request, reply, error);
    }
  });

  app.patch("/v1/messages/conversations/:conversationId/creator-requests/:requestId", mutationRateLimit("paymentMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const { conversationId, resourceId: requestId } = readCommercialParams(request, "requestId");
    const idempotencyKey = requiredIdempotencyKey(request);
    const body = request.body as Partial<UpdateStructuredCreatorRequestRequest> | undefined;
    if (!conversationId || !requestId || !idempotencyKey || !body?.action || !requestActions.has(body.action) || !validOptionalTerms(body)) {
      return reply.code(400).send(validationResponse("A valid creator-request action and Idempotency-Key are required"));
    }
    try {
      const response = await options.messageRepository.updateStructuredCreatorRequest({
        supabaseUserId: access.supabaseUserId,
        conversationId,
        requestId,
        body: body as UpdateStructuredCreatorRequestRequest,
        idempotencyKey,
        requestHash: hashMessageActionRequest({ requestId, ...body })
      });
      return response
        ? reply.code(200).send(response)
        : reply.code(404).send({ code: "not_found", message: "Creator request was not found" });
    } catch (error) {
      return handleCommercialError(request, reply, error);
    }
  });

  app.post("/v1/messages/conversations/:conversationId/creator-requests/:requestId/payment-intents", mutationRateLimit("paymentMutation"), async (request, reply) => {
    return createCommercialPaymentIntent(app, options, request, reply, "creator_request");
  });
}

async function createCommercialPaymentIntent(
  app: FastifyInstance,
  options: RegisterMessageRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  kind: "media_offer" | "creator_request"
) {
  const access = await verifyMessageReadyAccess(request, options);
  if (!access.ok) return reply.code(access.statusCode).send(access.body);
  const key = kind === "media_offer" ? "offerId" : "requestId";
  const { conversationId, resourceId } = readCommercialParams(request, key);
  const idempotencyKey = requiredIdempotencyKey(request);
  if (!conversationId || !resourceId || !idempotencyKey) {
    return reply.code(400).send(validationResponse("A valid commercial interaction and Idempotency-Key are required"));
  }
  const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;
  if (!platformFeeWallet) return reply.code(503).send({ code: "service_unavailable", message: "Payments are not configured" });
  try {
    assertSolanaAddress(platformFeeWallet);
    const authority = kind === "media_offer"
      ? await options.messageRepository.findCreatorMediaOfferPaymentAuthority({ supabaseUserId: access.supabaseUserId, conversationId, offerId: resourceId })
      : await options.messageRepository.findStructuredCreatorRequestPaymentAuthority({ supabaseUserId: access.supabaseUserId, conversationId, requestId: resourceId });
    if (!authority) return reply.code(409).send({ code: "conflict", message: kind === "creator_request" ? "Creator acceptance is required before payment" : "This media offer is not payable" });
    if (authority.paymentIntentId) {
      const existing = await options.paymentRepository.findIntent({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: authority.paymentIntentId
      });
      if (!existing || existing.targetId !== authority.targetId || existing.productType !== authority.productType) {
        return reply.code(409).send({ code: "conflict", message: "The commercial payment binding is inconsistent" });
      }
      return reply.code(201).send(toPaymentIntentResponse(existing));
    }
    const commercialPolicy = defaultPaymentCommercialPolicy(app.config, authority.productType, authority.currency);
    const intent = await options.paymentRepository.createOrReuseIntent({
      supabaseUserId: access.supabaseUserId,
      idempotencyKey,
      requestHash: hashMessageActionRequest({ kind, resourceId, amountMinor: authority.amountMinor, currency: authority.currency }),
      productType: authority.productType,
      targetId: authority.targetId,
      amountMinor: authority.amountMinor,
      currency: authority.currency,
      tokenMint: authority.currency === "USDC" ? app.config.PAYMENT_USDC_MINT ?? null : null,
      tokenDecimals: authority.currency === "USDC" ? app.config.PAYMENT_USDC_DECIMALS : null,
      solanaCluster: app.config.SOLANA_CLUSTER,
      treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET ?? platformFeeWallet,
      platformFeeWallet,
      ...commercialPolicy,
      settlementKind: "creator_split",
      creatorUserId: authority.creatorUserId,
      referenceAddress: createSolanaReferenceAddress(),
      referralToken: null
    });
    const bound = kind === "media_offer"
      ? await options.messageRepository.bindCreatorMediaOfferPaymentIntent({ supabaseUserId: access.supabaseUserId, conversationId, resourceId, paymentIntentId: intent.id })
      : await options.messageRepository.bindStructuredCreatorRequestPaymentIntent({ supabaseUserId: access.supabaseUserId, conversationId, resourceId, paymentIntentId: intent.id });
    if (!bound) return reply.code(409).send({ code: "conflict", message: "The interaction changed before payment could be prepared" });
    return reply.code(201).send(toPaymentIntentResponse(intent));
  } catch (error) {
    return handleCommercialError(request, reply, error);
  }
}

function validateMediaOffer(body: Partial<CreateCreatorMediaOfferRequest> | undefined) {
  if (!body || !uuidPattern.test(body.contentItemId ?? "")) return "contentItemId must be a UUID";
  if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.length > 120) return "title is required and must be 120 characters or fewer";
  if (body.description != null && (typeof body.description !== "string" || body.description.length > 1000)) return "description must be 1000 characters or fewer";
  if (!validAmount(body.amountMinor) || (body.currency !== "SOL" && body.currency !== "USDC")) return "A valid amount and currency are required";
  if (!validFutureDate(body.expiresAt)) return "expiresAt must be a future date";
  return null;
}

function validateCreatorRequest(body: Partial<CreateStructuredCreatorRequestRequest> | undefined) {
  if (!body || !uuidPattern.test(body.creatorUserId ?? "")) return "creatorUserId must be a UUID";
  const textFields = [body.deliverable, body.clarificationRule, body.cancellationRule];
  if (textFields.some((value) => typeof value !== "string" || value.trim().length < 3)) return "Deliverable, clarification, and cancellation rules are required";
  if (body.deliverable!.length > 1000 || body.clarificationRule!.length > 500 || body.cancellationRule!.length > 500) return "Creator request terms are too long";
  if (textFields.some((value) => prohibitedPersonalAccess.test(value!))) return "Requests cannot promise personal, romantic, sexual, or offline access";
  if (!body.permittedCategory || !permittedCategories.has(body.permittedCategory)) return "A permitted category is required";
  if (body.proposedAmountMinor != null && !validAmount(body.proposedAmountMinor)) return "proposedAmountMinor is invalid";
  if (body.currency !== "SOL" && body.currency !== "USDC") return "currency must be SOL or USDC";
  if (body.expectedDeliveryDays != null && (!Number.isInteger(body.expectedDeliveryDays) || body.expectedDeliveryDays < 1 || body.expectedDeliveryDays > 90)) return "expectedDeliveryDays must be between 1 and 90";
  if (!validFutureDate(body.expiresAt)) return "expiresAt must be a future date";
  return null;
}

function validOptionalTerms(body: Partial<UpdateStructuredCreatorRequestRequest>) {
  if (body.agreedAmountMinor != null && !validAmount(body.agreedAmountMinor)) return false;
  if (body.expectedDeliveryDays != null && (!Number.isInteger(body.expectedDeliveryDays) || body.expectedDeliveryDays < 1 || body.expectedDeliveryDays > 90)) return false;
  for (const value of [body.clarificationRule, body.cancellationRule]) {
    if (value != null && (value.trim().length < 3 || value.length > 500 || prohibitedPersonalAccess.test(value))) return false;
  }
  return true;
}

function validAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validFutureDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

function readConversationId(request: FastifyRequest) {
  const value = (request.params as { conversationId?: string }).conversationId ?? "";
  return uuidPattern.test(value) ? value : null;
}

function readCommercialParams(request: FastifyRequest, resourceKey: "offerId" | "requestId") {
  const params = request.params as { conversationId?: string; offerId?: string; requestId?: string };
  const conversationId = uuidPattern.test(params.conversationId ?? "") ? params.conversationId! : null;
  const candidate = resourceKey === "offerId" ? params.offerId : params.requestId;
  return { conversationId, resourceId: uuidPattern.test(candidate ?? "") ? candidate! : null };
}

function handleCommercialError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof MessageIdempotencyConflictError || error instanceof PaymentIdempotencyConflictError) {
    return reply.code(409).send({ code: "conflict", message: "Idempotency key was already used" });
  }
  if (error instanceof MessageBlockedError || error instanceof MessageRequestForbiddenError) {
    return reply.code(403).send({ code: "forbidden", message: "The current consent boundary does not allow this action" });
  }
  if (error instanceof PaymentRecipientNotReadyError) return reply.code(409).send({ code: "conflict", message: "This creator cannot receive payments yet" });
  if (error instanceof PaymentAmountBelowPolicyError) return reply.code(400).send(validationResponse(`Amount must be at least ${error.minimumAmountMinor} atomic units`));
  if (error instanceof MessageRepositoryConfigurationError || error instanceof PaymentRepositoryConfigurationError || error instanceof SolanaPaymentConfigurationError) {
    request.log.warn({ error }, "Commercial message interaction failed");
    return reply.code(503).send({ code: "service_unavailable", message: "Commercial interactions are not configured" });
  }
  throw error;
}
