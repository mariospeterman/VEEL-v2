import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import {
  OrganizationRepositoryConfigurationError
} from "./organization-repository.js";
import type { OrganizationRepository } from "./types.js";

interface RegisterOrganizationRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
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

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
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
