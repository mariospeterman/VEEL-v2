import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { AdminRepositoryConfigurationError } from "./admin-repository.js";
import type { AdminRepository } from "./types.js";

interface RegisterAdminRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  adminRepository: AdminRepository;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): Promise<void> {
  app.get("/v1/admin/ops/summary", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getOpsSummary());
  });

  app.get("/v1/admin/payments/intents", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listPaymentIntents(adminListInput(query)));
  });

  app.get("/v1/admin/unlocks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listUnlocks(adminListInput(query)));
  });

  app.get("/v1/admin/provider-events", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listProviderEvents(adminListInput(query)));
  });
}

function adminListInput(query: { q?: string; cursor?: string }): { query?: string; cursor?: string } {
  return {
    ...(query.q ? { query: query.q } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {})
  };
}

async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions
): Promise<boolean> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return false;
  }

  try {
    const allowed = await options.adminRepository.hasAdminAccess(verifiedSession.supabaseUserId);

    if (!allowed) {
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is required"
      });
      return false;
    }

    return true;
  } catch (error) {
    if (error instanceof AdminRepositoryConfigurationError) {
      request.log.warn({ error }, "Admin repository is not configured");
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is not configured"
      });
      return false;
    }

    throw error;
  }
}
