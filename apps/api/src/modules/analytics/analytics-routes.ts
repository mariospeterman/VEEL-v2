import type { FastifyInstance } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ApplicationSessionVerifier } from "../session/types.js";
import type { AdminRepository } from "../admin/types.js";
import { AdminRepositoryConfigurationError } from "../admin/admin-repository.js";
import { readIdempotentMutationRequest } from "../../shared/idempotency.js";
import { AnalyticsIdempotencyConflictError, AnalyticsQueryValidationError, AnalyticsRepositoryConfigurationError } from "./analytics-errors.js";
import { AnalyticsQueryService, validateProjectionWindow } from "./analytics-service.js";
import type { AnalyticsQueryRequest, AnalyticsRepository, AnalyticsWindow } from "./types.js";

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

  app.post(
    "/v1/admin/analytics/jobs",
    {
      schema: contractRouteSchema("enqueueAdminAnalyticsJob"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      const body = request.body as {
        jobType?: "backfill" | "reconciliation";
        window?: AnalyticsWindow;
        reason?: string;
      };
      try {
        if (!(await options.adminRepository.hasAdminAccess(session.supabaseUserId))) {
          return reply.code(403).send({ code: "forbidden", message: "Admin access is required" });
        }
        if (!body || !["backfill", "reconciliation"].includes(body.jobType ?? "")
          || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500
          || !body.window) {
          return reply.code(400).send({ code: "validation_failed", message: "A job type, bounded window, and reason are required" });
        }
        validateProjectionWindow(body.window);
        const idempotency = readIdempotentMutationRequest(request, body);
        if ("code" in idempotency) return reply.code(400).send(idempotency);
        const job = await options.analyticsRepository.enqueueProjectionJob({
          actorUserId: session.userId,
          jobType: body.jobType as "backfill" | "reconciliation",
          window: body.window,
          reason: body.reason.trim(),
          idempotencyKey: idempotency.idempotencyKey,
          requestHash: idempotency.requestHash
        });
        return reply.code(202).send(job);
      } catch (error) {
        if (error instanceof AnalyticsQueryValidationError) {
          return reply.code(400).send({ code: "validation_failed", message: error.message });
        }
        if (error instanceof AnalyticsIdempotencyConflictError) {
          return reply.code(409).send({ code: "idempotency_conflict", message: error.message });
        }
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
