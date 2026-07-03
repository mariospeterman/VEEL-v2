import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { createApiDependencies, type BuildApiOptions } from "./app-dependencies.js";
import { registerApiHealthRoutes } from "./app-health.js";
import { registerApiCloseHooks } from "./app-lifecycle.js";
import { registerApiRoutes } from "./app-routes.js";
import { envPlugin } from "./plugins/env.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { supabaseBoundaryPlugin } from "./plugins/supabase-boundary.js";

export type { BuildApiOptions } from "./app-dependencies.js";

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
        "HELIUS_API_KEY",
        "HELIUS_WEBHOOK_SECRET",
        "COINBASE_CDP_API_KEY_SECRET",
        "SUMSUB_WEBHOOK_SECRET"
      ]
    }
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: localWebOrigins(process.env.WEB_URL ?? "http://localhost:3000"),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"]
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true
  });
  await app.register(envPlugin);
  await app.register(supabaseBoundaryPlugin);

  const dependencies = createApiDependencies(app, options);
  registerApiCloseHooks(app, dependencies);
  await registerApiHealthRoutes(app, dependencies);
  await registerApiRoutes(app, dependencies);
  await app.register(openApiPlugin);

  return app;
}

function localWebOrigins(webUrl: string) {
  const origins = new Set([webUrl]);

  try {
    const url = new URL(webUrl);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      origins.add(url.toString().replace(/\/$/, ""));
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      origins.add(url.toString().replace(/\/$/, ""));
    }
  } catch {
    return webUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://localhost:3008");
    origins.add("http://127.0.0.1:3008");
  }

  return [...origins];
}
