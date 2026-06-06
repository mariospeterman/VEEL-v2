import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import { ContentRepositoryConfigurationError } from "../content/content-repository.js";
import type { ContentRepository, ContentUnlockIntent } from "../content/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import {
  PaymentIdempotencyConflictError,
  PaymentRepositoryConfigurationError
} from "./payment-repository.js";
import {
  assertSolanaAddress,
  buildSolanaPayTransferRequestUrl,
  createSolanaReferenceAddress,
  SolanaPaymentConfigurationError
} from "./solana-payment.js";
import type {
  CreatePaymentIntentRequest,
  PaymentIntent,
  PaymentEvidenceRepository,
  PaymentRepository,
  PaymentSettlementVerifier,
  ProductType,
  SubmitPaymentSignatureRequest,
  WebhookReceipt
} from "./types.js";

interface RegisterPaymentRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
  paymentRepository: PaymentRepository;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  settlementVerifier: PaymentSettlementVerifier;
}

const productTypes = new Set([
  "tip",
  "support",
  "content_unlock",
  "paid_message",
  "live_pass",
  "event_ticket",
  "creator_subscription",
  "platform_subscription"
]);
const paymentIntentTtlMs = 15 * 60 * 1000;

export async function registerPaymentRoutes(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  app.post("/v1/webhooks/solana-indexer", async (request, reply) => {
    if (!app.config.HELIUS_WEBHOOK_SECRET) {
      return reply.code(503).send(serviceUnavailableResponse("Solana indexer webhook is not configured"));
    }

    const authorization = request.headers.authorization;

    if (
      typeof authorization !== "string" ||
      !secureStringEquals(authorization, app.config.HELIUS_WEBHOOK_SECRET)
    ) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid webhook authorization"));
    }

    const events = normalizeHeliusWebhookPayload(request.body);
    let processed = 0;

    try {
      for (const event of events) {
        const isNewEvent = await options.paymentEvidenceRepository.recordSolanaProviderEvent({
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          signature: event.signature,
          referenceAddresses: event.referenceAddresses,
          authorizationHash: hashWebhookAuthorization(authorization)
        });

        if (!isNewEvent) {
          continue;
        }

        const match = await options.paymentEvidenceRepository.findIntentByReference({
          referenceAddresses: event.referenceAddresses
        });

        if (!match) {
          await options.paymentEvidenceRepository.updateSolanaProviderEvent({
            providerEventId: event.providerEventId,
            normalizedState: "ignored"
          });
          continue;
        }

        const settlement = await options.settlementVerifier.verifyNativeSolTransfer({
          signature: event.signature,
          referenceAddress: match.intent.referenceAddress,
          treasuryWallet: match.intent.treasuryWallet,
          amountMinor: match.intent.amountMinor
        });

        await options.paymentRepository.recordSubmission({
          supabaseUserId: match.supabaseUserId,
          paymentIntentId: match.intent.id,
          signature: event.signature,
          settlement
        });
        await options.paymentEvidenceRepository.updateSolanaProviderEvent({
          providerEventId: event.providerEventId,
          normalizedState: settlement.confirmed ? "processed" : "failed"
        });

        if (settlement.confirmed) {
          processed += 1;
        }
      }
    } catch (error) {
      if (error instanceof PaymentRepositoryConfigurationError) {
        request.log.warn({ error }, "Solana indexer webhook handling failed");
        return reply.code(503).send(serviceUnavailableResponse("Solana indexer webhook is not configured"));
      }

      throw error;
    }

    const receipt: WebhookReceipt = {
      provider: "helius",
      received: events.length,
      processed
    };

    return reply.code(202).send(receipt);
  });

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

    if (!app.config.PAYMENT_PLATFORM_TREASURY_WALLET) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Payment treasury wallet is not configured"
      });
    }

    try {
      assertSolanaAddress(app.config.PAYMENT_PLATFORM_TREASURY_WALLET);
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
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET,
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

type PaymentReadyAccessResult =
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

async function verifyPaymentReadyAccess(
  request: FastifyRequest,
  options: RegisterPaymentRoutesOptions
): Promise<PaymentReadyAccessResult> {
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
        message: "Payments require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

interface NormalizedHeliusWebhookEvent {
  providerEventId: string;
  eventType: string;
  signature: string;
  referenceAddresses: string[];
}

function normalizeHeliusWebhookPayload(payload: unknown): NormalizedHeliusWebhookEvent[] {
  const records = Array.isArray(payload) ? payload : [payload];
  const events: NormalizedHeliusWebhookEvent[] = [];

  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }

    const objectRecord = record as Record<string, unknown>;
    const signature = getString(objectRecord, "signature") ?? getString(objectRecord, "transactionSignature");

    if (!signature) {
      continue;
    }

    events.push({
      providerEventId: signature,
      eventType: getString(objectRecord, "type") ?? "payment.settlement",
      signature,
      referenceAddresses: extractSolanaAddresses(record)
    });
  }

  return events;
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractSolanaAddresses(value: unknown): string[] {
  const addresses = new Set<string>();
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      if (isLikelySolanaAddress(entry)) {
        addresses.add(entry);
      }
      return;
    }

    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    if (entry && typeof entry === "object") {
      for (const item of Object.values(entry)) visit(item);
    }
  };

  visit(value);

  return [...addresses];
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function hashWebhookAuthorization(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureStringEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function validateCreatePaymentIntentRequest(
  body: Partial<CreatePaymentIntentRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.productType !== "string" || !productTypes.has(body.productType)) {
    return "Unsupported productType";
  }

  if (typeof body.targetId !== "string" || body.targetId.length === 0) {
    return "targetId is required";
  }

  if (!Number.isSafeInteger(body.amountMinor) || Number(body.amountMinor) <= 0) {
    return "amountMinor is required for native SOL payment intents";
  }

  if (
    body.referralToken !== undefined &&
    body.referralToken !== null &&
    (typeof body.referralToken !== "string" || body.referralToken.length === 0)
  ) {
    return "referralToken must be a non-empty string when provided";
  }

  return null;
}

function hashPaymentIntentRequest(body: CreatePaymentIntentRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        productType: body.productType,
        targetId: body.targetId,
        amountMinor: body.amountMinor ?? null,
        livePassDurationMinutes: body.livePassDurationMinutes ?? null,
        referralToken: body.referralToken ?? null
      })
    )
    .digest("hex");
}

function toPaymentIntentResponse(intent: {
  id: string;
  productType: ProductType;
  amountMinor: number;
  currency: "SOL" | "USDC";
  state: PaymentIntent["state"];
}): PaymentIntent {
  return {
    id: intent.id,
    productType: intent.productType,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    state: intent.state
  };
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
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
