import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import { AgeRepositoryConfigurationError } from "./age-repository.js";
import {
  AgeWebhookConfigurationError,
  AgeWebhookSignatureError,
  AgeWebhookValidationError,
  normalizeAgeWebhook
} from "./age-webhook-adapter.js";
import {
  AgeProviderHttpError,
  AgeProviderIntegrationPendingError,
  AgeProviderUnavailableError
} from "./age-provider-waterfall.js";
import { isMockVerificationProviderReference } from "../verification/verification-provider-adapters.js";
import {
  findAgeStatusForUser,
  type AgeProviderWaterfall,
  type AgeRepository,
  type AgeProvider,
  type CreateAgeSessionRequest
} from "./types.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";

interface RegisterAgeRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  ageProviderWaterfall: AgeProviderWaterfall;
}

const ageProviderPreferences = new Set(["reusable_first", "didit", "yoti", "sumsub", "veriff", "persona"]);
const definitiveProviderCreateRejections = new Set([400, 401, 403]);
// Didit V3 uses one application-level webhook destination across workflows.
// Route every Didit event through the normalized verification webhook so age,
// adult eligibility, KYC, and KYB sessions share one idempotency boundary.
type DirectAgeWebhookProvider = Extract<AgeProvider, "sumsub" | "yoti">;

export async function registerAgeRoutes(
  app: FastifyInstance,
  options: RegisterAgeRoutesOptions
): Promise<void> {
  const receiveAgeWebhook =
    (provider: DirectAgeWebhookProvider) => async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const rawBody = rawBodyBuffer(request.rawBody);
        const normalized = normalizeAgeWebhook({
          provider,
          body: request.body,
          rawBody,
          headers: request.headers,
          env: app.config
        });
        const result = provider === "yoti"
          ? await applyAuthenticatedYotiResult(options, normalized.providerReference)
          : await options.ageRepository.applyProviderWebhook({
              provider: normalized.provider,
              providerEventId: normalized.providerEventId,
              eventType: normalized.eventType,
              providerReference: normalized.providerReference,
              providerSubjectReference: normalized.providerSubjectReference ?? null,
              providerCorrelationId: normalized.providerCorrelationId ?? null,
              state: normalized.state,
              verifiedAt: normalized.occurredAt ?? null,
              failureCode: normalized.failureCode ?? null,
              signatureHash: normalized.signatureHash,
              payloadHash: createHash("sha256").update(rawBody).digest("hex")
            });

        return reply.code(provider === "yoti" ? 200 : 202).send({
          provider: normalized.provider,
          received: 1,
          processed: result === "applied" || result === true ? 1 : 0
        });
      } catch (error) {
        if (error instanceof AgeWebhookSignatureError) {
          return reply.code(401).send(unauthorizedResponse("Missing or invalid webhook signature"));
        }

        if (error instanceof AgeWebhookValidationError) {
          return reply.code(400).send({
            code: "validation_failed",
            message: error.message
          });
        }

        if (
          error instanceof AgeWebhookConfigurationError ||
          error instanceof AgeRepositoryConfigurationError ||
          error instanceof AgeProviderHttpError ||
          error instanceof AgeProviderUnavailableError
        ) {
          request.log.warn({ error }, "Age webhook is not configured");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Age webhook is not configured"
          });
        }

        throw error;
      }
    };

  app.post(
    "/v1/webhooks/age/sumsub",
    {
      config: {
        rawBody: true
      }
    },
    receiveAgeWebhook("sumsub")
  );

  app.post(
    "/v1/webhooks/age/yoti",
    {
      config: {
        rawBody: true
      }
    },
    receiveAgeWebhook("yoti")
  );

  app.post("/v1/age/sessions", mutationRateLimit("ageMutation", "createAgeSession"), async (request, reply) => {
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

    const body = request.body as Partial<CreateAgeSessionRequest> | undefined;
    const providerPreference = body?.providerPreference;

    if (typeof providerPreference !== "string" || !ageProviderPreferences.has(providerPreference)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "providerPreference is required"
      });
    }

    let reservedSessionId: string | null = null;
    let providerRequestStarted = false;
    try {
      const latestAgeStatus = await findAgeStatusForUser(
        options.ageRepository,
        verifiedSession.userId
      );

      if (latestAgeStatus.state === "verified") {
        return reply.code(409).send({
          code: "conflict",
          message: "Age verification is already verified"
        });
      }

      const supportsDurableHandoff = Boolean(
        options.ageRepository.reservePendingAgeVerification &&
        options.ageRepository.selectPendingAgeProvider &&
        options.ageRepository.completePendingAgeVerification
      );
      const reservation = supportsDurableHandoff
        ? await options.ageRepository.reservePendingAgeVerification?.({
            userId: verifiedSession.userId,
            idempotencyKey,
            requestHash: createHash("sha256").update(JSON.stringify({ providerPreference })).digest("hex"),
            providerPreference
          })
        : null;
      reservedSessionId = reservation?.id ?? null;
      if (
        reservation?.attempt &&
        reservation.shouldCreateProviderSession === false
      ) {
        return reply
          .code(reservation.attempt.launchState === "reconciling" || reservation.attempt.launchState === "reserved" ? 202 : 200)
          .send(reservation.attempt);
      }
      const providerSession = await options.ageProviderWaterfall.createSession({
        supabaseUserId: verifiedSession.userId,
        providerPreference,
        idempotencyKey,
        subjectReference: reservation?.subjectReference ?? null,
        callbackUrl: `${app.config.WEB_URL}/age/callback`,
        webhookBaseUrl: `${app.config.API_URL}/v1/webhooks/age`,
        ...(reservation
          ? { onProviderSelected: async (selection) => {
              await options.ageRepository.selectPendingAgeProvider!({
                sessionId: reservation.id,
                ...selection
              });
              providerRequestStarted = true;
            } }
          : {})
      });

      if (reservation) {
        await options.ageRepository.completePendingAgeVerification?.({
          sessionId: reservation.id,
          providerSession
        });
      } else {
        await options.ageRepository.createPendingAgeVerification({
          userId: verifiedSession.userId,
          provider: providerSession.provider,
          providerReference: providerSession.providerReference,
          ...(providerSession.providerExternalUserId
            ? { providerExternalUserId: providerSession.providerExternalUserId }
            : {}),
          jurisdiction: providerSession.jurisdiction ?? null,
          rule: providerSession.rule ?? null,
          expiresAt: providerSession.expiresAt
        });
      }

      if (isMockVerificationProviderReference(app.config, providerSession.providerReference)) {
        await options.ageRepository.updateVerificationFromWebhook({
          provider: providerSession.provider,
          providerEventId: `${providerSession.providerReference}:auto-approved`,
          providerReference: providerSession.providerReference,
          state: "verified",
          verifiedAt: new Date(),
          failureCode: null
        });
      }

      return reply.code(201).send(reservation
        ? {
            id: reservation.id,
            provider: providerSession.provider,
            providerReference: providerSession.providerReference,
            launchUrl: providerSession.launchUrl,
            expiresAt: providerSession.expiresAt.toISOString(),
            launchState: "ready",
            status: "pending",
            resumable: true
          }
        : {
            id: providerSession.providerReference,
            provider: providerSession.provider,
            providerReference: providerSession.providerReference,
            launchUrl: providerSession.launchUrl,
            expiresAt: providerSession.expiresAt.toISOString(),
            launchState: "ready",
            status: "pending",
            resumable: false
          });
    } catch (error) {
      const definitiveProviderRejection =
        error instanceof AgeProviderHttpError &&
        definitiveProviderCreateRejections.has(error.status);
      if (reservedSessionId && providerRequestStarted && !definitiveProviderRejection) {
        await options.ageRepository.markPendingAgeVerificationReconciling?.({
          sessionId: reservedSessionId,
          reason: "provider_create_outcome_ambiguous"
        }).catch(() => undefined);
        const attempt = await options.ageRepository.findAgeVerificationAttempt?.({
          userId: verifiedSession.userId,
          sessionId: reservedSessionId
        }).catch(() => null);
        if (attempt) return reply.code(202).send(attempt);
      } else if (reservedSessionId && options.ageRepository.failPendingAgeVerification) {
        await options.ageRepository.failPendingAgeVerification({
          sessionId: reservedSessionId,
          reason: definitiveProviderRejection
            ? `provider_create_rejected_${error.status}`
            : error instanceof Error
              ? error.name
              : "provider_session_failed"
        }).catch(() => undefined);
      }
      if (error instanceof Error && ["IDEMPOTENCY_KEY_REUSED", "VERIFICATION_SESSION_ALREADY_RESERVED"].includes(error.message)) {
        return reply.code(409).send({
          code: "conflict",
          message: error.message === "IDEMPOTENCY_KEY_REUSED"
            ? "Idempotency-Key was already used with different age-verification input"
            : "This age-verification session request has already been reserved"
        });
      }
      if (
        error instanceof AgeProviderUnavailableError ||
        error instanceof AgeProviderIntegrationPendingError ||
        error instanceof AgeProviderHttpError
      ) {
        request.log.warn({ error }, "Age verification provider is unavailable");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Age verification provider is not configured"
        });
      }

      if (error instanceof AgeRepositoryConfigurationError) {
        request.log.warn({ error }, "Age repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Age verification storage is not configured"
        });
      }

      throw error;
    }
  });

  app.get(
    "/v1/age/sessions/:sessionId",
    { schema: contractRouteSchema("getAgeSession") },
    async (request, reply) => {
      const verifiedSession = await verifyRequestSession(request, options.authVerifier);
      if (!verifiedSession) {
        return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      }
      const { sessionId } = request.params as { sessionId?: string };
      if (!sessionId || !isUuid(sessionId)) {
        return reply.code(400).send({ code: "validation_failed", message: "sessionId must be a UUID" });
      }
      const attempt = await options.ageRepository.findAgeVerificationAttempt?.({
        userId: verifiedSession.userId,
        sessionId
      });
      if (!attempt) return reply.code(404).send({ code: "not_found", message: "Age session not found" });
      return reply.code(200).send(attempt);
    }
  );

  app.post(
    "/v1/age/sessions/:sessionId/resume",
    mutationRateLimit("ageMutation", "resumeAgeSession"),
    async (request, reply) => {
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
      const { sessionId } = request.params as { sessionId?: string };
      if (!sessionId || !isUuid(sessionId)) {
        return reply.code(400).send({ code: "validation_failed", message: "sessionId must be a UUID" });
      }
      let attempt = await options.ageRepository.recordAgeVerificationReconciliationAttempt?.({
        userId: verifiedSession.userId,
        sessionId
      });
      if (!attempt) return reply.code(404).send({ code: "not_found", message: "Age session not found" });

      try {
        if (
          attempt.launchState === "reconciling" &&
          attempt.provider &&
          attempt.providerReference &&
          options.ageProviderWaterfall.reconcileSession &&
          options.ageRepository.applyProviderReconciliation
        ) {
          const reconciliation = await options.ageProviderWaterfall.reconcileSession({
            provider: attempt.provider,
            providerReference: attempt.providerReference
          });
          if (reconciliation.launchUrl && reconciliation.expiresAt) {
            await options.ageRepository.completePendingAgeVerification?.({
              sessionId,
              providerSession: {
                provider: attempt.provider,
                providerReference: reconciliation.providerReference,
                ...(reconciliation.providerSubjectReference
                  ? { providerExternalUserId: reconciliation.providerSubjectReference }
                  : {}),
                launchUrl: reconciliation.launchUrl,
                expiresAt: reconciliation.expiresAt,
                rule: "over_18"
              }
            });
          }
          await options.ageRepository.applyProviderReconciliation(reconciliation);
          attempt = await options.ageRepository.findAgeVerificationAttempt?.({
            userId: verifiedSession.userId,
            sessionId
          }) ?? attempt;
        }
      } catch (error) {
        if (
          error instanceof AgeProviderUnavailableError ||
          error instanceof AgeProviderIntegrationPendingError ||
          error instanceof AgeProviderHttpError
        ) {
          request.log.warn({ error, sessionId }, "Age verification reconciliation is unavailable");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Age verification provider is unavailable"
          });
        }
        throw error;
      }

      return reply.code(attempt.launchState === "reconciling" || attempt.launchState === "reserved" ? 202 : 200).send(attempt);
    }
  );

  app.get("/v1/age/status", { schema: contractRouteSchema("getAgeStatus") }, async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const ageStatus = await findAgeStatusForUser(options.ageRepository, verifiedSession.userId);

      return reply.code(200).send(ageStatus);
    } catch (error) {
      if (error instanceof AgeRepositoryConfigurationError) {
        request.log.warn({ error }, "Age repository is not configured");
        return reply.code(200).send({
          state: "required",
          provider: null
        });
      }

      throw error;
    }
  });
}

async function applyAuthenticatedYotiResult(
  options: RegisterAgeRoutesOptions,
  providerReference: string
): Promise<boolean> {
  if (!options.ageProviderWaterfall.reconcileSession || !options.ageRepository.applyProviderReconciliation) {
    throw new AgeRepositoryConfigurationError();
  }
  const reconciliation = await options.ageProviderWaterfall.reconcileSession({
    provider: "yoti",
    providerReference
  });
  return options.ageRepository.applyProviderReconciliation(reconciliation);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rawBodyBuffer(rawBody: string | Buffer | undefined): Buffer {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }

  if (typeof rawBody === "string") {
    return Buffer.from(rawBody);
  }

  return Buffer.alloc(0);
}
