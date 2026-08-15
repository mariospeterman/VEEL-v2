import type { FastifyInstance } from "fastify";
import { Connection } from "@solana/web3.js";
import {
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository.js";
import {
  assertSolanaAddress,
  buildCreatorSplitTransaction,
  buildSolanaPayTransactionRequestUrl,
  buildStoredSolanaPayTransactionRequestUrl,
  createPaymentCheckoutToken,
  createSolanaReferenceAddress,
  hashPaymentCheckoutToken,
  paymentMemo,
  SolanaPaymentConfigurationError
} from "./solana-payment.js";
import type {
  CreatePaymentIntentRequest,
  SubmitPaymentSignatureRequest,
  TransactionRequestPostRequest
} from "./types.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import {
  hashPaymentIntentRequest,
  notFoundResponse,
  paymentIntentTtlMs,
  requiredIdempotencyKey,
  toPaymentIntentResponse,
  validateCreatePaymentIntentRequest,
  validationResponse,
  verifyPaymentReadyAccess
} from "./payment-route-shared.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";

export async function registerPaymentIntentRoutes(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  const solanaConnection = new Connection(app.config.SOLANA_RPC_URL, "confirmed");

  app.post("/v1/payments/intents", mutationRateLimit("paymentMutation"), async (request, reply) => {
    const access = await verifyPaymentReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreatePaymentIntentRequest> | undefined;
    const currency = body?.currency ?? app.config.PAYMENT_DEFAULT_ASSET;
    const minimumAmountMinor =
      currency === "USDC"
        ? app.config.PAYMENT_MIN_SUPPORT_USDC_ATOMIC
        : app.config.PAYMENT_MIN_SUPPORT_SOL_LAMPORTS;
    const validationError = validateCreatePaymentIntentRequest(body, { minimumAmountMinor });

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const platformFeeWallet = app.config.PAYMENT_PLATFORM_FEE_WALLET ?? app.config.PAYMENT_PLATFORM_TREASURY_WALLET;

    if (!platformFeeWallet) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Payment platform fee wallet is not configured"
      });
    }

    if (currency === "USDC" && !app.config.PAYMENT_USDC_MINT) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "USDC payments are not configured"
      });
    }

    try {
      assertSolanaAddress(platformFeeWallet);
      if (app.config.PAYMENT_USDC_MINT) {
        assertSolanaAddress(app.config.PAYMENT_USDC_MINT);
      }      const intentBody = body as CreatePaymentIntentRequest & { amountMinor: number };
      const intent = await options.paymentRepository.createOrReuseIntent({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashPaymentIntentRequest({ ...intentBody, currency }),
        productType: intentBody.productType,
        targetId: intentBody.targetId,
        amountMinor: intentBody.amountMinor,
        currency,
        tokenMint: currency === "USDC" ? (app.config.PAYMENT_USDC_MINT ?? null) : null,
        tokenDecimals: currency === "USDC" ? app.config.PAYMENT_USDC_DECIMALS : null,
        solanaCluster: app.config.SOLANA_CLUSTER,
        treasuryWallet: app.config.PAYMENT_PLATFORM_TREASURY_WALLET ?? platformFeeWallet,
        platformFeeWallet,
        platformFeeBps: app.config.PAYMENT_PLATFORM_FEE_BPS,
        referralShareOfPlatformFeeBps: app.config.PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS,
        settlementKind: "creator_split",
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

      if (error instanceof PaymentRecipientNotReadyError) {
        return reply.code(409).send({
          code: "conflict",
          message: "This creator cannot receive payments yet"
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

      if (intent.state === "confirmed") {
        return reply.code(409).send({
          code: "conflict",
          message: "Payment intent is already settled"
        });
      }

      if (intent.expiresAt <= new Date()) {
        return reply.code(400).send(validationResponse("Payment intent is expired"));
      }

      const checkoutToken = createPaymentCheckoutToken();
      const transactionRequestUrl = buildSolanaPayTransactionRequestUrl({
        apiUrl: app.config.API_URL,
        checkoutToken
      });
      const transactionRequest = await options.paymentRepository.recordTransactionRequest({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: intent.id,
        publicTransactionRequestUrl: transactionRequestUrl,
        storedTransactionRequestUrl: buildStoredSolanaPayTransactionRequestUrl(app.config.API_URL),
        checkoutTokenHash: hashPaymentCheckoutToken(checkoutToken)
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

  app.get(
    "/v1/payments/checkout/:checkoutToken",
    { logLevel: "silent" },
    async (request, reply) => {
      const checkoutToken = (request.params as { checkoutToken?: string }).checkoutToken ?? "";

      if (!isValidCheckoutToken(checkoutToken)) {
        return reply.code(404).send(notFoundResponse("Checkout was not found"));
      }

      try {
        const intent = await options.paymentRepository.findCheckoutIntent({
          checkoutTokenHash: hashPaymentCheckoutToken(checkoutToken)
        });

        if (!intent) {
          return reply.code(404).send(notFoundResponse("Checkout was not found"));
        }

        return reply.code(200).send({
          label: "WeVid",
          icon: new URL("/favicon.ico", app.config.WEB_URL).toString()
        });
      } catch (error) {
        if (error instanceof PaymentRepositoryConfigurationError) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Payments are not configured"
          });
        }

        throw error;
      }
    }
  );

  app.post(
    "/v1/payments/checkout/:checkoutToken",
    { ...mutationRateLimit("paymentMutation"), logLevel: "silent" },
    async (request, reply) => {
      const checkoutToken = (request.params as { checkoutToken?: string }).checkoutToken ?? "";
      const body = request.body as Partial<TransactionRequestPostRequest> | undefined;

      if (!isValidCheckoutToken(checkoutToken)) {
        return reply.code(404).send(notFoundResponse("Checkout was not found"));
      }

      if (!body || typeof body.account !== "string" || body.account.length === 0) {
        return reply.code(400).send(validationResponse("account is required"));
      }

      try {
        assertSolanaAddress(body.account);
      } catch {
        return reply.code(400).send(validationResponse("account must be a valid Solana public key"));
      }

      try {
        const intent = await options.paymentRepository.recordCheckoutPayer({
          checkoutTokenHash: hashPaymentCheckoutToken(checkoutToken),
          buyerWallet: body.account
        });

        if (!intent) {
          return reply.code(404).send(notFoundResponse("Checkout was not found"));
        }

        if (intent.settlementKind !== "creator_split") {
          return reply.code(400).send(validationResponse("Only creator_split intents use transaction requests"));
        }

        const transaction = await buildCreatorSplitTransaction({
          connection: solanaConnection,
          intent,
          buyerWallet: body.account
        });
        return reply.code(200).send({
          transaction,
          message: `Sign WeVid payment ${intent.id}`
        });
      } catch (error) {
        if (
          error instanceof PaymentRepositoryConfigurationError ||
          error instanceof SolanaPaymentConfigurationError
        ) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Payments are not configured"
          });
        }

        throw error;
      }
    }
  );

  app.post(
    "/v1/payments/intents/:paymentIntentId/submissions",
    mutationRateLimit("paymentMutation"),
    async (request, reply) => {
      const access = await verifyPaymentReadyAccess(request, options);

      if (!access.ok) {
        return reply.code(access.statusCode).send(access.body);
      }

      const idempotencyKey = requiredIdempotencyKey(request);

      if (!idempotencyKey) {
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

        const settlement = await options.settlementVerifier.verifyTransfer({
          signature: body.signature,
          referenceAddress: intent.referenceAddress,
          memo: paymentMemo(intent.id),
          settlementKind: intent.settlementKind,
          buyerWallet: intent.buyerWallet,
          creatorWallet: intent.creatorWallet,
          enterpriseWallet: intent.enterpriseWallet,
          platformFeeWallet: intent.platformFeeWallet,
          referralWallet: intent.referralWallet,
          treasuryWallet: intent.treasuryWallet,
          totalAmountMinor: intent.totalAmountMinor,
          creatorAmountMinor: intent.creatorAmountMinor,
          enterpriseManagementAmountMinor: intent.enterpriseManagementAmountMinor,
          platformFeeAmountMinor: intent.platformFeeAmountMinor,
          referralAmountMinor: intent.referralAmountMinor,
          currency: intent.currency,
          tokenMint: intent.tokenMint ?? null,
          tokenDecimals: intent.tokenDecimals ?? null,
          expiresAt: intent.expiresAt
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
    }
  );
}

function isValidCheckoutToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
