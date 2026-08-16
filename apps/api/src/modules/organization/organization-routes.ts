import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import {
  OrganizationIdempotencyConflictError,
  OrganizationRepositoryConfigurationError,
  OrganizationStateConflictError
} from "./organization-repository.js";
import type { OrganizationRepository } from "./types.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";

interface RegisterOrganizationRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  organizationRepository: OrganizationRepository;
}

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  options: RegisterOrganizationRoutesOptions
): Promise<void> {
  app.get("/v1/organizations", async (request, reply) => {
    const access = await requireOrganizationAccess(request, reply, options);

    if (!access) {
      return reply;
    }

    const query = request.query as { cursor?: string };

    try {
      const dashboards = await options.organizationRepository.listMyDashboards({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(dashboards);
    } catch (error) {
      if (error instanceof OrganizationRepositoryConfigurationError) {
        request.log.warn({ error }, "Organization repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Organizations are not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/organizations/:organizationId/members", async (request, reply) => {
    const session = await verifyRequestSession(request, options.authVerifier);
    if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
    const { organizationId } = request.params as { organizationId: string };
    try {
      const members = await options.organizationRepository.listMembers({
        supabaseUserId: session.supabaseUserId,
        organizationId
      });
      return members
        ? reply.send({ items: members })
        : reply.code(404).send({ code: "not_found", message: "Organization members are unavailable" });
    } catch (error) { return handleOrganizationError(request, reply, error); }
  });

  app.post(
    "/v1/organizations/:organizationId/members",
    mutationRateLimit("accessMutation", "inviteOrganizationMember"),
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
      const idempotencyKey = readIdempotencyKey(request.headers["idempotency-key"]);
      const body = request.body as { handle?: unknown; role?: unknown } | undefined;
      if (!idempotencyKey || typeof body?.handle !== "string" || !body.handle.trim() ||
        (body.role !== "admin" && body.role !== "member" && body.role !== "viewer")) {
        return reply.code(400).send({ code: "validation_failed", message: "Handle, team role, and idempotency key are required" });
      }
      const { organizationId } = request.params as { organizationId: string };
      const normalized: { handle: string; role: "admin" | "member" | "viewer" } = {
        handle: body.handle.trim().toLowerCase(),
        role: body.role
      };
      try {
        const member = await options.organizationRepository.inviteMember({
          supabaseUserId: session.supabaseUserId,
          organizationId,
          ...normalized,
          idempotencyKey,
          requestHash: hashRequest(normalized)
        });
        return member
          ? reply.code(201).send(member)
          : reply.code(403).send({ code: "forbidden", message: "Enterprise team invitation is not allowed" });
      } catch (error) { return handleOrganizationError(request, reply, error); }
    }
  );

  app.post(
    "/v1/organization-memberships/:membershipId/responses",
    mutationRateLimit("accessMutation", "respondToOrganizationMembership"),
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
      const idempotencyKey = readIdempotencyKey(request.headers["idempotency-key"]);
      const decision = (request.body as { decision?: unknown } | undefined)?.decision;
      if (!idempotencyKey || (decision !== "accept" && decision !== "decline")) {
        return reply.code(400).send({ code: "validation_failed", message: "Decision and idempotency key are required" });
      }
      const { membershipId } = request.params as { membershipId: string };
      try {
        const member = await options.organizationRepository.respondToMembership({
          supabaseUserId: session.supabaseUserId,
          membershipId,
          decision,
          idempotencyKey,
          requestHash: hashRequest({ decision })
        });
        return member
          ? reply.send(member)
          : reply.code(409).send({ code: "conflict", message: "Organization invitation is no longer actionable" });
      } catch (error) { return handleOrganizationError(request, reply, error); }
    }
  );

  app.patch(
    "/v1/organizations/:organizationId/members/:membershipId",
    mutationRateLimit("accessMutation", "updateOrganizationMember"),
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Authentication is required"));
      const idempotencyKey = readIdempotencyKey(request.headers["idempotency-key"]);
      const body = request.body as { role?: unknown; state?: unknown } | undefined;
      if (!idempotencyKey || (body?.role !== "admin" && body?.role !== "member" && body?.role !== "viewer") ||
        (body.state !== "active" && body.state !== "suspended" && body.state !== "removed")) {
        return reply.code(400).send({ code: "validation_failed", message: "Role, state, and idempotency key are required" });
      }
      const { organizationId, membershipId } = request.params as { organizationId: string; membershipId: string };
      const normalized: {
        role: "admin" | "member" | "viewer";
        state: "active" | "suspended" | "removed";
      } = { role: body.role, state: body.state };
      try {
        const member = await options.organizationRepository.updateMember({
          supabaseUserId: session.supabaseUserId,
          organizationId,
          membershipId,
          ...normalized,
          idempotencyKey,
          requestHash: hashRequest(normalized)
        });
        return member
          ? reply.send(member)
          : reply.code(403).send({ code: "forbidden", message: "Only an active owner can update team roles" });
      } catch (error) { return handleOrganizationError(request, reply, error); }
    }
  );
}

function readIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function handleOrganizationError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof OrganizationRepositoryConfigurationError) {
    request.log.warn({ error }, "Organization repository is not configured");
    return reply.code(503).send({ code: "service_unavailable", message: "Organizations are not configured" });
  }
  if (error instanceof OrganizationIdempotencyConflictError) {
    return reply.code(409).send({ code: "idempotency_conflict", message: "Idempotency key was already used for a different request" });
  }
  if (error instanceof OrganizationStateConflictError) {
    return reply.code(409).send({ code: "conflict", message: error.message });
  }
  throw error;
}

async function requireOrganizationAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterOrganizationRoutesOptions
): Promise<{ supabaseUserId: string } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified") {
    reply.code(403).send({
      code: "forbidden",
      message: "Organization dashboards require profile and age verification"
    });
    return null;
  }

  return {
    supabaseUserId: verifiedSession.supabaseUserId
  };
}
