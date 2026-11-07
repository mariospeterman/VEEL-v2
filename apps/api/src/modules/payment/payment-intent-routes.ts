import type { FastifyInstance } from "fastify";
import { Connection } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  PaymentConsentConflictError,
  PaymentAmountBelowPolicyError,
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository.js";
import {
  assertSolanaAddress,
  buildCreatorSplitTransaction,
  createPaymentCheckoutToken,
  createSolanaReferenceAddress,
  hashPaymentCheckoutToken,
  isValidSolanaSignature,
  paymentMemo,
  SolanaPaymentConfigurationError,
  validateSignedPaymentTransaction
} from "./solana-payment.js";
import {
  createStoredWeVidTransactionRequestUrl,
  createWeVidTransactionRequest
} from "./solana-pay-codec.js";
import type {
  AcceptPaymentIntentTermsRequest,
  CreatePaymentIntentRequest,
  SubmitPaymentSignatureRequest,
  TransactionRequestPostRequest
} from "./types.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import {
  hashPaymentIntentRequest,
  notFoundResponse,
  requiredIdempotencyKey,
  toPaymentIntentResponse,
  validateCreatePaymentIntentRequest,
  validationResponse,
  verifyPaymentReadyAccess
} from "./payment-route-shared.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { MutationCommandIdempotencyConflictError } from "../../shared/mutation-command-receipt.js";
import { defaultPaymentCommercialPolicy } from "./payment-commercial-policy.js";
import { PaymentSubmissionWriteConflictError } from "./payment-submission.js";
import {
  verifyPaymentSettlementWithinDeadline,
  verifyPaymentTransactionExpiryWithinDeadline
} from "./payment-settlement-deadline.js";

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
    const commercialPolicy = defaultPaymentCommercialPolicy(app.config, "support", currency);
    const validationError = validateCreatePaymentIntentRequest(body);

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
      }

      const intentBody = body as CreatePaymentIntentRequest & { amountMinor: number };
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
        ...commercialPolicy,
        settlementKind: "creator_split",
        referenceAddress: createSolanaReferenceAddress(),
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

      if (error instanceof PaymentAmountBelowPolicyError) {
        return reply.code(400).send(validationResponse(
          `Support amount must be at least ${error.minimumAmountMinor} atomic units`
        ));
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

  app.post(
    "/v1/payments/intents/:paymentIntentId/consent",
    mutationRateLimit("paymentMutation", "acceptPaymentIntentTerms"),
    async (request, reply) => {
      const access = await verifyPaymentReadyAccess(request, options);

      if (!access.ok) {
        return reply.code(access.statusCode).send(access.body);
      }

      const idempotencyKey = requiredIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
      }

      const body = request.body as Partial<AcceptPaymentIntentTermsRequest> | undefined;
      if (
        !body ||
        typeof body.termsVersion !== "string" ||
        typeof body.withdrawalWaiverVersion !== "string" ||
        typeof body.immediateAccessAcknowledged !== "boolean"
      ) {
        return reply.code(400).send(validationResponse("Checkout consent fields are required"));
      }

      const params = request.params as { paymentIntentId?: string };
      const paymentIntentId = params.paymentIntentId ?? "";
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            paymentIntentId,
            termsVersion: body.termsVersion,
            withdrawalWaiverVersion: body.withdrawalWaiverVersion,
            immediateAccessAcknowledged: body.immediateAccessAcknowledged
          })
        )
        .digest("hex");

      try {
        if (!options.paymentRepository.acceptCheckoutTerms) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Checkout consent storage is not configured"
          });
        }

        const intent = await options.paymentRepository.acceptCheckoutTerms({
          supabaseUserId: access.supabaseUserId,
          paymentIntentId,
          idempotencyKey,
          requestHash,
          termsVersion: body.termsVersion,
          withdrawalWaiverVersion: body.withdrawalWaiverVersion,
          immediateAccessAcknowledged: body.immediateAccessAcknowledged
        });

        if (!intent) {
          return reply.code(404).send(notFoundResponse("Payment intent was not found"));
        }

        return reply.code(200).send(toPaymentIntentResponse(intent));
      } catch (error) {
        if (error instanceof PaymentIdempotencyConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Idempotency key was already used for different checkout consent"
          });
        }

        if (error instanceof PaymentConsentConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Checkout terms changed, expired, or were not acknowledged"
          });
        }

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

      if (["submitted", "confirming", "confirmed", "settled"].includes(intent.state)) {
        return reply.code(409).send({
          code: "conflict",
          message: "Payment was already submitted; resume verification instead of creating another wallet request"
        });
      }

      if (intent.expiresAt <= new Date()) {
        return reply.code(400).send(validationResponse("Payment intent is expired"));
      }

      if (intent.withdrawalWaiverRequired && !intent.withdrawalWaiverAcceptedAt) {
        return reply.code(409).send({
          code: "conflict",
          message: "Review and accept the checkout terms before opening a wallet request"
        });
      }

      const checkoutToken = createPaymentCheckoutToken();
      const transactionRequest = await createWeVidTransactionRequest({
        apiUrl: app.config.API_URL,
        checkoutToken
      });
      const recordedTransactionRequest = await options.paymentRepository.recordTransactionRequest({
        supabaseUserId: access.supabaseUserId,
        paymentIntentId: intent.id,
        publicTransactionRequestUrl: transactionRequest.transactionRequestUrl,
        storedTransactionRequestUrl: createStoredWeVidTransactionRequestUrl(app.config.API_URL),
        checkoutTokenHash: hashPaymentCheckoutToken(checkoutToken)
      });

      if (!recordedTransactionRequest) {
        return reply.code(404).send(notFoundResponse("Payment intent was not found"));
      }

      return reply.code(200).send({
        ...recordedTransactionRequest,
        checkoutUrl: transactionRequest.checkoutUrl,
        qrDataUrl: transactionRequest.qrDataUrl
      });
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

      if (!isValidSolanaSignature(body.signature)) {
        return reply.code(400).send(validationResponse("signature must be a valid Solana transaction signature"));
      }

      if (
        typeof body.signedTransactionBase64 !== "string" ||
        body.signedTransactionBase64.length === 0 ||
        body.signedTransactionBase64.length > 4_096
      ) {
        return reply.code(400).send(validationResponse(
          "signedTransactionBase64 is required and must be a bounded base64 transaction"
        ));
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

        if (!validateSignedPaymentTransaction({
          signature: body.signature,
          signedTransactionBase64: body.signedTransactionBase64,
          buyerWallet: intent.buyerWallet
        })) {
          return reply.code(400).send(validationResponse(
            "signedTransactionBase64 must contain the exact valid payer-signed transaction"
          ));
        }

        if (intent.withdrawalWaiverRequired && !intent.withdrawalWaiverAcceptedAt) {
          return reply.code(409).send({
            code: "conflict",
            message: "Review and accept the checkout terms before submitting payment"
          });
        }

        if (!["pending", "transaction_requested", "submitted"].includes(intent.state)) {
          const exactReplay = await options.paymentRepository.hasSubmissionCommandReceipt?.({
            supabaseUserId: access.supabaseUserId,
            paymentIntentId: intent.id,
            idempotencyKey,
            signature: body.signature
          });
          if (exactReplay) {
            return reply.code(202).send();
          }

          return reply.code(409).send({
            code: "conflict",
            message: "Payment intent cannot accept a transaction submission in its current state"
          });
        }

        const acceptedState = intent.state as "pending" | "transaction_requested" | "submitted";

        // Persist the wallet-authorized signature before any RPC lookup. A provider outage or a
        // lost HTTP acknowledgement can then be recovered by replaying this exact command instead
        // of constructing and approving a second transfer.
        await options.paymentRepository.recordSubmission({
          supabaseUserId: access.supabaseUserId,
          paymentIntentId: intent.id,
          idempotencyKey,
          signature: body.signature,
          settlement: { confirmed: false },
          writeGuard: {
            state: acceptedState,
            submittedSignature: acceptedState === "submitted" ? body.signature : null
          }
        });

        let settlement: Awaited<ReturnType<typeof options.settlementVerifier.verifyTransfer>>;
        try {
          settlement = await verifyPaymentSettlementWithinDeadline(options.settlementVerifier, {
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
        } catch (error) {
          request.log.warn(
            { error, paymentIntentId: intent.id },
            "Payment signature was accepted but immediate settlement verification is unavailable"
          );
          return reply.code(202).send();
        }

        if (
          !settlement.confirmed &&
          settlement.failureCode === "not_found" &&
          intent.expiresAt <= new Date() &&
          options.settlementVerifier.verifyTransactionExpiry
        ) {
          try {
            const expiry = await verifyPaymentTransactionExpiryWithinDeadline(
              options.settlementVerifier,
              {
                signature: body.signature,
                signedTransactionBase64: body.signedTransactionBase64,
                buyerWallet: intent.buyerWallet
              }
            );

            if (expiry.state === "invalid") {
              return reply.code(400).send(validationResponse(
                "signedTransactionBase64 must contain the exact valid payer-signed transaction"
              ));
            }

            if (expiry.state === "expired") {
              settlement = {
                confirmed: false,
                failureCode: "signed_transaction_expired"
              };
            }
          } catch (error) {
            request.log.warn(
              { error, paymentIntentId: intent.id },
              "Expired payment submission remains recoverable while transaction expiry proof is unavailable"
            );
            return reply.code(202).send();
          }
        }

        try {
          await options.paymentRepository.recordSubmission({
            supabaseUserId: access.supabaseUserId,
            paymentIntentId: intent.id,
            signature: body.signature,
            settlement,
            writeGuard: {
              state: "submitted",
              submittedSignature: body.signature
            }
          });
        } catch (error) {
          if (!(error instanceof PaymentSubmissionWriteConflictError)) throw error;
          request.log.info(
            { paymentIntentId: intent.id },
            "Payment submission advanced concurrently after signature acceptance"
          );
        }

        return reply.code(202).send();
      } catch (error) {
        if (error instanceof MutationCommandIdempotencyConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Idempotency key was already used for a different payment submission"
          });
        }

        if (error instanceof PaymentSubmissionWriteConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "A different payment submission is already being reconciled for this intent"
          });
        }

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
