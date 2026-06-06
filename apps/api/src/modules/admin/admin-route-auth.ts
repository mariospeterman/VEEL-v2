import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { AdminRepositoryConfigurationError } from "./admin-repository.js";
import type { AdminRepository } from "./types.js";

export interface RegisterAdminRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  adminRepository: AdminRepository;
}

export function adminListInput(query: { q?: string; cursor?: string }): { query?: string; cursor?: string } {
  return {
    ...(query.q ? { query: query.q } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {})
  };
}

export async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions
): Promise<boolean> {
  const access = await requireAdminAccessWithUser(request, reply, options);
  return Boolean(access);
}

export async function requireAdminAccessWithUser(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions
): Promise<{ supabaseUserId: string } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  try {
    const isAdmin = await options.adminRepository.hasAdminAccess(verifiedSession.supabaseUserId);

    if (!isAdmin) {
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is required"
      });
      return null;
    }

    return { supabaseUserId: verifiedSession.supabaseUserId };
  } catch (error) {
    if (error instanceof AdminRepositoryConfigurationError) {
      request.log.warn({ error }, "Admin repository is not configured");
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is not configured"
      });
      return null;
    }

    throw error;
  }
}

export async function featureFlagEnabled(repository: AdminRepository, key: string): Promise<boolean> {
  const flags = await repository.listFeatureFlags();
  const flag = flags.items.find((item) => item.key === key);

  if (!flag || flag.state !== "active") {
    return false;
  }

  if (typeof flag.value !== "object" || flag.value === null || Array.isArray(flag.value)) {
    return false;
  }

  return (flag.value as { enabled?: unknown }).enabled === true;
}
