import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { AgeRepositoryConfigurationError } from "./age-repository.js";
import type { AgeRepository } from "./types.js";

interface RegisterAgeRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  ageRepository: AgeRepository;
}

export async function registerAgeRoutes(
  app: FastifyInstance,
  options: RegisterAgeRoutesOptions
): Promise<void> {
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
