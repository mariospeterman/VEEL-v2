import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { VerificationRepositoryConfigurationError } from "./verification-repository.js";
import type { VerificationRepository } from "./types.js";

interface RegisterVerificationRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  verificationRepository: VerificationRepository;
}

export async function registerVerificationRoutes(
  app: FastifyInstance,
  options: RegisterVerificationRoutesOptions
): Promise<void> {
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
