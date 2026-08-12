import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { VerificationProviderUnavailableError } from "../verification/verification-provider-adapters.js";
import type { VerificationProviderWaterfall } from "../verification/types.js";
import { PerformerRepositoryConfigurationError } from "./performer-repository.js";
import type { PerformerAllowedUse, PerformerRepository } from "./types.js";

interface PerformerRouteOptions {
  authVerifier: SupabaseAuthVerifier;
  performerRepository: PerformerRepository;
  verificationProviderWaterfall: VerificationProviderWaterfall;
}

const allowedUseValues = new Set<PerformerAllowedUse>([
  "capture", "upload", "distribution", "monetisation", "live", "replay", "promotion"
]);

export async function registerPerformerRoutes(app: FastifyInstance, options: PerformerRouteOptions): Promise<void> {
  app.get("/v1/content/:contentId/performers", async (request, reply) => {
    const access = await verifyRequestSession(request, options.authVerifier);
    if (!access) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    try {
      const { contentId } = request.params as { contentId: string };
      return reply.send({ items: await options.performerRepository.listForContent({
        supabaseUserId: access.supabaseUserId, contentId
      }) });
    } catch (error) {
      return performerError(request, reply, error);
    }
  });

  app.post("/v1/content/:contentId/performers", mutationRateLimit("ageMutation"), async (request, reply) => {
    const access = await verifyRequestSession(request, options.authVerifier);
    if (!access) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const body = request.body as {
      performerHandle?: string;
      externalLabel?: string;
      allowedUses?: PerformerAllowedUse[];
    } | undefined;
    const performerHandle = cleanText(body?.performerHandle, 64);
    const externalLabel = cleanText(body?.externalLabel, 120);
    const allowedUses = body?.allowedUses;
    const idempotencyKey = request.headers["idempotency-key"];
    if (
      (!performerHandle && !externalLabel) || Boolean(performerHandle && externalLabel) ||
      !Array.isArray(allowedUses) || allowedUses.length === 0 ||
      new Set(allowedUses).size !== allowedUses.length ||
      allowedUses.some((value) => !allowedUseValues.has(value)) ||
      typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 128
    ) {
      return reply.code(400).send({ code: "validation_failed", message: "Provide one performer and valid allowed uses" });
    }

    const rawToken = externalLabel ? randomBytes(32).toString("base64url") : null;
    try {
      const { contentId } = request.params as { contentId: string };
      const result = await options.performerRepository.createRequest({
        supabaseUserId: access.supabaseUserId,
        contentId,
        performerHandle,
        externalLabel,
        allowedUses,
        invitationTokenHash: rawToken ? tokenHash(rawToken) : null,
        invitationExpiresAt: rawToken ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) : null,
        idempotencyKey
      });
      if (!result) return reply.code(404).send({ code: "not_found", message: "Content or performer was not found" });
      return reply.code(201).send({
        request: result.request,
        invitationUrl: rawToken && result.invitationCreated
          ? `${app.config.WEB_URL.replace(/\/$/, "")}/performer-consent/${rawToken}`
          : null
      });
    } catch (error) {
      return performerError(request, reply, error);
    }
  });

  app.post("/v1/performer-consents/:requestId/responses", mutationRateLimit("ageMutation"), async (request, reply) => {
    const access = await verifyRequestSession(request, options.authVerifier);
    if (!access) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const decision = readDecision(request.body);
    if (!decision || !validIdempotencyKey(request.headers["idempotency-key"])) return reply.code(400).send({ code: "validation_failed", message: "Decision and idempotency key are required" });
    try {
      const { requestId } = request.params as { requestId: string };
      const item = await options.performerRepository.respondAsLinkedUser({
        supabaseUserId: access.supabaseUserId, requestId, decision
      });
      return item
        ? reply.send(item)
        : reply.code(409).send({ code: "performer_consent_not_ready", message: "The request is unavailable or verification is incomplete" });
    } catch (error) {
      return performerError(request, reply, error);
    }
  });

  app.get("/v1/performer-invitations/:token", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!validToken(token)) return reply.code(404).send({ code: "not_found", message: "Invitation was not found" });
    try {
      const item = await options.performerRepository.findInvitation({ invitationTokenHash: tokenHash(token) });
      return item ? reply.send(item) : reply.code(404).send({ code: "not_found", message: "Invitation was not found" });
    } catch (error) {
      return performerError(request, reply, error);
    }
  });

  app.post("/v1/performer-invitations/:token/verification-sessions", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const idempotencyKey = request.headers["idempotency-key"];
    if (!validToken(token) || typeof idempotencyKey !== "string" || idempotencyKey.length > 128) {
      return reply.code(400).send({ code: "validation_failed", message: "A valid invitation and idempotency key are required" });
    }
    try {
      const invitationTokenHash = tokenHash(token);
      const invitation = await options.performerRepository.findInvitation({ invitationTokenHash });
      if (!invitation) return reply.code(404).send({ code: "not_found", message: "Invitation was not found" });
      const providerSession = await options.verificationProviderWaterfall.createSession({
        supabaseUserId: `performer:${invitation.id}`,
        purpose: "performer_eligibility",
        providerPreference: "provider_first",
        idempotencyKey,
        subjectReference: `performer-request:${invitation.id}`,
        callbackUrl: `${app.config.WEB_URL.replace(/\/$/, "")}/performer-consent/return`,
        webhookBaseUrl: `${app.config.API_URL}/v1/webhooks/verification`
      });
      const id = await options.performerRepository.createVerificationSession({ invitationTokenHash, providerSession });
      if (!id) return reply.code(409).send({ code: "performer_consent_not_ready", message: "Invitation is no longer active" });
      return reply.code(201).send({
        id, provider: providerSession.provider, providerReference: providerSession.providerReference,
        launchUrl: providerSession.launchUrl,
        expiresAt: providerSession.expiresAt.toISOString(), purpose: "performer_eligibility"
      });
    } catch (error) {
      if (error instanceof VerificationProviderUnavailableError) {
        return reply.code(503).send({ code: "service_unavailable", message: "Performer verification is temporarily unavailable" });
      }
      return performerError(request, reply, error);
    }
  });

  app.post("/v1/performer-invitations/:token/responses", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const decision = readDecision(request.body);
    if (!validToken(token) || !decision || !validIdempotencyKey(request.headers["idempotency-key"])) {
      return reply.code(400).send({ code: "validation_failed", message: "A valid invitation and decision are required" });
    }
    try {
      const item = await options.performerRepository.respondToInvitation({
        invitationTokenHash: tokenHash(token), decision
      });
      return item
        ? reply.send(item)
        : reply.code(409).send({ code: "performer_consent_not_ready", message: "Complete verification before accepting" });
    } catch (error) {
      return performerError(request, reply, error);
    }
  });
}

function performerError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof PerformerRepositoryConfigurationError) {
    request.log.warn({ error }, "Performer consent repository unavailable");
    return reply.code(503).send({ code: "service_unavailable", message: "Performer consent is temporarily unavailable" });
  }
  throw error;
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= maximum ? clean : null;
}

function readDecision(body: unknown): "accept" | "reject" | null {
  const decision = (body as { decision?: unknown } | null)?.decision;
  return decision === "accept" || decision === "reject" ? decision : null;
}

function validToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
