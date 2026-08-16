import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./app-dependencies.js";

type HealthCheckStatus = "ok" | "degraded" | "unavailable" | "not_configured";

type HealthResponse = {
  service: string;
  status: "ok" | "degraded" | "unavailable";
  environment: string;
  version: string;
  commit: string;
  timestamp: string;
  checks: Record<string, { status: HealthCheckStatus; message?: string }>;
};

const serviceName = "veel-api";

function baseHealth(status: HealthResponse["status"], checks: HealthResponse["checks"]): HealthResponse {
  return {
    service: serviceName,
    status,
    environment: process.env.NODE_ENV ?? "development",
    version: process.env.APP_VERSION ?? "0.0.0",
    commit: process.env.GIT_SHA ?? "local",
    timestamp: new Date().toISOString(),
    checks
  };
}

export async function registerApiHealthRoutes(
  app: FastifyInstance,
  dependencies: Pick<ApiDependencies, "postgresClient">
): Promise<void> {
  app.get("/healthz", { config: { rateLimit: false } }, async () =>
    baseHealth("ok", {
      api: { status: "ok" }
    })
  );

  app.get("/readyz", { config: { rateLimit: false } }, async (_request, reply) => {
    if (!dependencies.postgresClient) {
      const response = baseHealth("degraded", {
        api: { status: "ok" },
        postgres: { status: "not_configured", message: "DATABASE_URL is not configured" }
      });

      return reply.code(503).send(response);
    }

    try {
      await dependencies.postgresClient`select 1 as ready`;
      return baseHealth("ok", {
        api: { status: "ok" },
        postgres: { status: "ok" }
      });
    } catch (error) {
      app.log.warn({ err: error }, "readiness postgres check failed");

      const response = baseHealth("unavailable", {
        api: { status: "ok" },
        postgres: { status: "unavailable", message: "Postgres readiness check failed" }
      });

      return reply.code(503).send(response);
    }
  });
}
