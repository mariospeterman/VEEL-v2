import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import { AgeRepositoryConfigurationError } from "./age-repository.js";
import {
  AgeProviderIntegrationPendingError,
  AgeProviderUnavailableError
} from "./age-provider-waterfall.js";
import type {
  AgeProviderWaterfall,
  AgeRepository,
  CreateAgeSessionRequest
} from "./types.js";

interface RegisterAgeRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  ageProviderWaterfall: AgeProviderWaterfall;
}

const ageProviderPreferences = new Set(["reusable_first", "yoti", "sumsub", "veriff", "persona"]);

export async function registerAgeRoutes(
  app: FastifyInstance,
  options: RegisterAgeRoutesOptions
): Promise<void> {
  app.post("/v1/age/sessions", async (request, reply) => {
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

    try {
      await options.sessionRepository.ensureUserForSupabaseId(verifiedSession.supabaseUserId);
      const latestAgeStatus = await options.ageRepository.findLatestAgeStatusBySupabaseUserId(
        verifiedSession.supabaseUserId
      );

      if (latestAgeStatus.state === "verified" || latestAgeStatus.state === "pending") {
        return reply.code(409).send({
          code: "conflict",
          message: `Age verification is already ${latestAgeStatus.state}`
        });
      }

      const providerSession = await options.ageProviderWaterfall.createSession({
        supabaseUserId: verifiedSession.supabaseUserId,
        providerPreference,
        idempotencyKey,
        callbackUrl: `${app.config.WEB_URL}/age/callback`,
        webhookBaseUrl: `${app.config.API_URL}/v1/webhooks/age`
      });

      await options.ageRepository.createPendingAgeVerification({
        supabaseUserId: verifiedSession.supabaseUserId,
        provider: providerSession.provider,
        providerReference: providerSession.providerReference,
        jurisdiction: providerSession.jurisdiction ?? null,
        rule: providerSession.rule ?? null,
        expiresAt: providerSession.expiresAt
      });

      return reply.code(201).send({
        id: providerSession.providerReference,
        provider: providerSession.provider,
        launchUrl: providerSession.launchUrl,
        expiresAt: providerSession.expiresAt.toISOString()
      });
    } catch (error) {
      if (
        error instanceof AgeProviderUnavailableError ||
        error instanceof AgeProviderIntegrationPendingError
      ) {
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

  app.get("/v1/age/status", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const ageStatus = await options.ageRepository.findLatestAgeStatusBySupabaseUserId(
        verifiedSession.supabaseUserId
      );

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
