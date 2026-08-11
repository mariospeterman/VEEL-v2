import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import {
  isMockVerificationProviderReference,
  VerificationProviderHttpError,
  VerificationProviderUnavailableError
} from "./verification-provider-adapters.js";
import { VerificationRepositoryConfigurationError } from "./verification-repository.js";
import {
  normalizeVerificationWebhook,
  VerificationWebhookConfigurationError,
  VerificationWebhookSignatureError,
  VerificationWebhookValidationError
} from "./verification-webhook-adapter.js";
import type { CreateVerificationSessionInput, VerificationProvider, VerificationProviderWaterfall, VerificationRepository } from "./types.js";

interface RegisterVerificationRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  verificationRepository: VerificationRepository;
  verificationProviderWaterfall: VerificationProviderWaterfall;
}

const verificationProviders = new Set<VerificationProvider>(["sumsub", "didit", "persona", "veriff"]);
const verificationPurposes = new Set(["adult_content_access", "creator_kyc", "org_kyb"]);
const providerPreferences = new Set(["provider_first", "sumsub", "didit", "persona", "veriff"]);

export async function registerVerificationRoutes(
  app: FastifyInstance,
  options: RegisterVerificationRoutesOptions
): Promise<void> {
  app.post(
    "/v1/webhooks/verification/:provider",
    {
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const params = request.params as { provider?: string };

      if (!params.provider || !verificationProviders.has(params.provider as VerificationProvider)) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "Unsupported verification provider"
        });
      }

      try {
        const rawBody = rawBodyBuffer(request.rawBody);
        const normalized = normalizeVerificationWebhook({
          provider: params.provider as VerificationProvider,
          body: request.body,
          rawBody,
          headers: request.headers,
          env: app.config
        });
        const result = await options.verificationRepository.applyProviderWebhook({
          ...normalized,
          payloadHash: createHash("sha256").update(rawBody).digest("hex")
        });

        return reply.code(202).send({
          provider: normalized.provider,
          received: 1,
          processed: result === "applied" ? 1 : 0
        });
      } catch (error) {
        if (error instanceof VerificationWebhookSignatureError) {
          return reply.code(401).send(unauthorizedResponse("Missing or invalid webhook signature"));
        }

        if (error instanceof VerificationWebhookValidationError) {
          return reply.code(400).send({
            code: "validation_failed",
            message: error.message
          });
        }

        if (
          error instanceof VerificationWebhookConfigurationError ||
          error instanceof VerificationRepositoryConfigurationError
        ) {
          request.log.warn({ error }, "Verification webhook is not configured");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Verification webhook is not configured"
          });
        }

        throw error;
      }
    }
  );

  app.post("/v1/verification/sessions", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<CreateVerificationSessionInput> | undefined;
    const purpose = body?.purpose;
    const providerPreference = body?.providerPreference ?? "provider_first";

    if (typeof purpose !== "string" || !verificationPurposes.has(purpose)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "purpose is required"
      });
    }

    if (typeof providerPreference !== "string" || !providerPreferences.has(providerPreference)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "providerPreference is invalid"
      });
    }

    try {
      const providerSession = await options.verificationProviderWaterfall.createSession({
        supabaseUserId: verifiedSession.supabaseUserId,
        purpose,
        providerPreference,
        organizationId: typeof body?.organizationId === "string" ? body.organizationId : null,
        idempotencyKey,
        callbackUrl: `${app.config.WEB_URL}/app/create?verification=callback`,
        webhookBaseUrl: `${app.config.API_URL}/v1/webhooks/verification`
      });
      const sessionId = await options.verificationRepository.createPendingSession({
        supabaseUserId: verifiedSession.supabaseUserId,
        purpose,
        organizationId: typeof body?.organizationId === "string" ? body.organizationId : null,
        providerSession
      });

      if (isMockVerificationProviderReference(app.config, providerSession.providerReference)) {
        await options.verificationRepository.updateVerificationFromWebhook({
          provider: providerSession.provider,
          providerEventId: `${providerSession.providerReference}:auto-approved`,
          providerReference: providerSession.providerReference,
          eventType: "mock.auto_approved",
          status: "valid",
          signatureHash: null,
          occurredAt: new Date(),
          failureReasonCode: null
        });
      }

      return reply.code(201).send({
        id: sessionId,
        provider: providerSession.provider,
        providerReference: providerSession.providerReference,
        launchUrl: providerSession.launchUrl,
        expiresAt: providerSession.expiresAt.toISOString(),
        purpose
      });
    } catch (error) {
      if (
        error instanceof VerificationProviderUnavailableError ||
        error instanceof VerificationProviderHttpError
      ) {
        request.log.warn({ error }, "Verification provider is unavailable");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Verification provider is not configured"
        });
      }

      if (error instanceof VerificationRepositoryConfigurationError) {
        request.log.warn({ error }, "Verification repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Verification storage is not configured"
        });
      }

      if (error instanceof Error && error.message === "ORGANIZATION_ACCESS_REQUIRED") {
        return reply.code(403).send({
          code: "forbidden",
          message: "Organization verification requires active membership"
        });
      }

      if (error instanceof Error && error.message === "ORGANIZATION_ID_REQUIRED") {
        return reply.code(400).send({
          code: "validation_failed",
          message: "organizationId is required for business verification"
        });
      }

      throw error;
    }
  });

  app.get("/v1/verification/status", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const query = request.query as { organizationId?: string };

    try {
      const status = await options.verificationRepository.resolveCapabilities({
        supabaseUserId: verifiedSession.supabaseUserId,
        organizationId: query.organizationId ?? null
      });

      return reply.code(200).send(status);
    } catch (error) {
      if (error instanceof VerificationRepositoryConfigurationError) {
        request.log.warn({ error }, "Verification status is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Verification status is not configured"
        });
      }

      throw error;
    }
  });
}

function rawBodyBuffer(rawBody: string | Buffer | undefined): Buffer {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody);
  return Buffer.alloc(0);
}
