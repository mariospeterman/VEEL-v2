import type { FastifyInstance } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ApplicationSessionVerifier } from "../session/types.js";
import type { AdminRepository } from "../admin/types.js";
import { AdminRepositoryConfigurationError } from "../admin/admin-repository.js";
import { AnalyticsQueryValidationError, AnalyticsRepositoryConfigurationError } from "./analytics-errors.js";
import { AnalyticsQueryService } from "./analytics-service.js";
import type { AnalyticsQueryRequest, AnalyticsRepository } from "./types.js";

interface RegisterAnalyticsRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  analyticsRepository: AnalyticsRepository;
  adminRepository: AdminRepository;
}

export async function registerAnalyticsRoutes(app: FastifyInstance, options: RegisterAnalyticsRoutesOptions): Promise<void> {
  const service = new AnalyticsQueryService(options.analyticsRepository);

  app.post(
    "/v1/analytics/query",
    {
      schema: contractRouteSchema("queryAnalytics"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      try {
        const result = await service.query(session.userId, request.body as AnalyticsQueryRequest);
        if (!result) return reply.code(403).send({ code: "forbidden", message: "Analytics scope is not available" });
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof AnalyticsQueryValidationError) {
          return reply.code(400).send({ code: "validation_failed", message: error.message });
        }
        if (error instanceof AnalyticsRepositoryConfigurationError) {
          return reply.code(503).send({ code: "service_unavailable", message: "Analytics storage is not configured" });
        }
        throw error;
      }
    }
  );

  app.get(
    "/v1/admin/analytics/health",
    { schema: contractRouteSchema("getAdminAnalyticsHealth") },
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      try {
        if (!(await options.adminRepository.hasAdminAccess(session.supabaseUserId))) {
          return reply.code(403).send({ code: "forbidden", message: "Admin access is required" });
        }
        return reply.code(200).send(await options.analyticsRepository.getProjectionHealth());
      } catch (error) {
        if (error instanceof AdminRepositoryConfigurationError) {
          return reply.code(403).send({ code: "forbidden", message: "Admin access is not configured" });
        }
        if (error instanceof AnalyticsRepositoryConfigurationError) {
          return reply.code(503).send({ code: "service_unavailable", message: "Analytics storage is not configured" });
        }
        throw error;
      }
    }
  );
}
