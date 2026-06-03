import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { createPostgresSessionRepository } from "./modules/session/session-repository.js";
import { registerSessionRoutes } from "./modules/session/session-routes.js";
import { createSupabaseAuthVerifier } from "./modules/session/supabase-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "./modules/session/types.js";
import { envPlugin } from "./plugins/env.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { supabaseBoundaryPlugin } from "./plugins/supabase-boundary.js";

export interface BuildApiOptions {
  authVerifier?: SupabaseAuthVerifier;
  sessionRepository?: SessionRepository;
}

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL"
      ]
    }
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  await app.register(envPlugin);
  await app.register(supabaseBoundaryPlugin);
  const authVerifier = options.authVerifier ?? createSupabaseAuthVerifier(app.config);
  const sessionRepository =
    options.sessionRepository ?? createPostgresSessionRepository(app.config.DATABASE_URL);

  if (sessionRepository.close) {
    app.addHook("onClose", async () => {
      await sessionRepository.close?.();
    });
  }

  await registerSessionRoutes(app, {
    authVerifier,
    sessionRepository
  });
  await app.register(openApiPlugin);

  return app;
}
