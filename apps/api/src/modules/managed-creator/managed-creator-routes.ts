import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ApplicationSessionVerifier } from "../session/types.js";
import {
  ManagedCreatorIdempotencyConflictError,
  ManagedCreatorRepositoryConfigurationError,
  ManagedCreatorStateConflictError
} from "./managed-creator-repository.js";
import type { ManagedCreatorPermission, ManagedCreatorRepository } from "./types.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";

const permissionValues = new Set<ManagedCreatorPermission>([
  "profile_readiness_view", "monetisation_settings_manage", "content_manage", "analytics_view", "revenue_allocation"
]);

export async function registerManagedCreatorRoutes(app: FastifyInstance, options: {
  authVerifier: ApplicationSessionVerifier; managedCreatorRepository: ManagedCreatorRepository;
}) {
  app.get("/v1/managed-creator-relationships", async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    try {
      return reply.send({ items: await options.managedCreatorRepository.listMine({ supabaseUserId: session.supabaseUserId }) });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.get("/v1/managed-creator-relationships/:relationshipId/reporting", async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const { relationshipId } = request.params as { relationshipId: string };
    try {
      const reporting = await options.managedCreatorRepository.getReporting({
        supabaseUserId: session.supabaseUserId,
        relationshipId
      });
      return reporting
        ? reply.send(reporting)
        : reply.code(404).send({ code: "not_found", message: "Enterprise reporting is unavailable" });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post("/v1/organizations/:organizationId/managed-creators", mutationRateLimit("accessMutation", "inviteManagedCreator"), async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const key = request.headers["idempotency-key"];
    const body = request.body as { creatorHandle?: unknown; permissions?: unknown; enterpriseManagementShareBps?: unknown; settlementWalletId?: unknown } | undefined;
    const permissions = body?.permissions;
    if (typeof key !== "string" || !key || key.length > 128 || typeof body?.creatorHandle !== "string" ||
      !Array.isArray(permissions) || permissions.length === 0 || permissions.some((p) => typeof p !== "string" || !permissionValues.has(p as ManagedCreatorPermission)) ||
      !Number.isInteger(body.enterpriseManagementShareBps) || Number(body.enterpriseManagementShareBps) < 0 || Number(body.enterpriseManagementShareBps) > 9999) {
      return reply.code(400).send({ code: "validation_failed", message: "Creator, permissions, share, and idempotency key are required" });
    }
    const { organizationId } = request.params as { organizationId: string };
    const normalized = {
      creatorHandle: body.creatorHandle.trim().toLowerCase(),
      permissions: [...new Set(permissions as ManagedCreatorPermission[])].sort(),
      enterpriseManagementShareBps: Number(body.enterpriseManagementShareBps),
      settlementWalletId: typeof body.settlementWalletId === "string" ? body.settlementWalletId : null
    };
    try {
      const item = await options.managedCreatorRepository.invite({
        supabaseUserId: session.supabaseUserId, organizationId, creatorHandle: normalized.creatorHandle,
        permissions: normalized.permissions, enterpriseManagementShareBps: normalized.enterpriseManagementShareBps,
        settlementWalletId: normalized.settlementWalletId,
        termsHash: requestHash({
          permissions: normalized.permissions,
          enterpriseManagementShareBps: normalized.enterpriseManagementShareBps
        }),
        idempotencyKey: key,
        requestHash: requestHash(normalized)
      });
      return item ? reply.code(201).send(item) : reply.code(403).send({ code: "forbidden", message: "Organization role or creator is not eligible" });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post("/v1/managed-creator-relationships/:relationshipId/responses", mutationRateLimit("accessMutation", "respondToManagedCreatorRelationship"), async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const decision = (request.body as { decision?: unknown } | undefined)?.decision;
    const key = request.headers["idempotency-key"];
    if ((decision !== "accept" && decision !== "decline") || typeof key !== "string" || !key || key.length > 128) {
      return reply.code(400).send({ code: "validation_failed", message: "Decision and idempotency key are required" });
    }
    const { relationshipId } = request.params as { relationshipId: string };
    try {
      const item = await options.managedCreatorRepository.respond({
        supabaseUserId: session.supabaseUserId,
        relationshipId,
        decision,
        idempotencyKey: key,
        requestHash: requestHash({ decision })
      });
      return item ? reply.send(item) : reply.code(409).send({ code: "conflict", message: "Relationship is no longer actionable" });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post("/v1/managed-creator-relationships/:relationshipId/agreements", mutationRateLimit("accessMutation", "proposeManagedCreatorAgreement"), async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const key = request.headers["idempotency-key"];
    const terms = readAgreementTerms(request.body);
    if (!terms || !validIdempotencyKey(key)) {
      return reply.code(400).send({ code: "validation_failed", message: "Permissions, share, and idempotency key are required" });
    }
    const { relationshipId } = request.params as { relationshipId: string };
    try {
      const item = await options.managedCreatorRepository.proposeAgreement({
        supabaseUserId: session.supabaseUserId,
        relationshipId,
        ...terms,
        termsHash: requestHash(terms),
        idempotencyKey: key,
        requestHash: requestHash(terms)
      });
      return item
        ? reply.code(201).send(item)
        : reply.code(409).send({ code: "conflict", message: "Relationship is not active or cannot be managed" });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post("/v1/managed-creator-relationships/:relationshipId/agreements/:agreementId/responses", mutationRateLimit("accessMutation", "respondToManagedCreatorAgreement"), async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const decision = (request.body as { decision?: unknown } | undefined)?.decision;
    if ((decision !== "accept" && decision !== "reject") || !validIdempotencyKey(request.headers["idempotency-key"])) {
      return reply.code(400).send({ code: "validation_failed", message: "Decision and idempotency key are required" });
    }
    const { relationshipId, agreementId } = request.params as { relationshipId: string; agreementId: string };
    try {
      const item = await options.managedCreatorRepository.respondToAgreement({
        supabaseUserId: session.supabaseUserId,
        relationshipId,
        agreementId,
        decision,
        idempotencyKey: request.headers["idempotency-key"] as string,
        requestHash: requestHash({ agreementId, decision })
      });
      return item
        ? reply.send(item)
        : reply.code(409).send({ code: "conflict", message: "Agreement is no longer actionable" });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post("/v1/managed-creator-relationships/:relationshipId/termination", mutationRateLimit("accessMutation", "terminateManagedCreatorRelationship"), async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const reason = (request.body as { reason?: unknown } | undefined)?.reason;
    if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 240 || !validIdempotencyKey(request.headers["idempotency-key"])) {
      return reply.code(400).send({ code: "validation_failed", message: "A short reason and idempotency key are required" });
    }
    const { relationshipId } = request.params as { relationshipId: string };
    try {
      const item = await options.managedCreatorRepository.terminate({
        supabaseUserId: session.supabaseUserId,
        relationshipId,
        reason: reason.trim(),
        idempotencyKey: request.headers["idempotency-key"] as string,
        requestHash: requestHash({ reason: reason.trim() })
      });
      return item
        ? reply.send(item)
        : reply.code(409).send({ code: "conflict", message: "Relationship cannot be terminated" });
    } catch (error) { return handleError(request, reply, error); }
  });
}

function readAgreementTerms(body: unknown): {
  permissions: ManagedCreatorPermission[];
  enterpriseManagementShareBps: number;
} | null {
  const value = body as { permissions?: unknown; enterpriseManagementShareBps?: unknown } | null;
  if (!Array.isArray(value?.permissions) || value.permissions.length === 0 ||
    value.permissions.some((permission) => typeof permission !== "string" || !permissionValues.has(permission as ManagedCreatorPermission)) ||
    !Number.isInteger(value.enterpriseManagementShareBps) || Number(value.enterpriseManagementShareBps) < 0 || Number(value.enterpriseManagementShareBps) > 9999) {
    return null;
  }
  return {
    permissions: [...new Set(value.permissions as ManagedCreatorPermission[])].sort(),
    enterpriseManagementShareBps: Number(value.enterpriseManagementShareBps)
  };
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function handleError(request: { log: { warn(value: unknown, message: string): void } }, reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) {
  if (error instanceof ManagedCreatorRepositoryConfigurationError) {
    request.log.warn({ error }, "Managed creator repository unavailable");
    return reply.code(503).send({ code: "service_unavailable", message: "Enterprise relationships are temporarily unavailable" });
  }
  if (error instanceof ManagedCreatorIdempotencyConflictError) {
    return reply.code(409).send({ code: "idempotency_conflict", message: "Idempotency key was already used for a different request" });
  }
  if (error instanceof ManagedCreatorStateConflictError) {
    return reply.code(409).send({ code: "conflict", message: error.message });
  }
  throw error;
}
