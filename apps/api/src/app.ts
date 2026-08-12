import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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
    trustProxy: trustedProxySetting(process.env.API_TRUST_PROXY),
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
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
  await app.register(envPlugin);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: false,
    hsts:
      app.config.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    referrerPolicy: { policy: "no-referrer" }
  });
  await app.register(cors, {
    origin: allowedWebOrigins(app.config.WEB_URL, app.config.NODE_ENV),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"]
  });

  if (app.config.API_RATE_LIMIT_STORE_DRIVER === "external" && !options.rateLimitStore) {
    throw new Error(
      "API_RATE_LIMIT_STORE_DRIVER=external requires a configured Fastify rate-limit store adapter"
    );
  }

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    ...(options.rateLimitStore ? { store: options.rateLimitStore } : {})
  });

  if (app.config.NODE_ENV === "production" && !options.rateLimitStore) {
    app.log.warn(
      "API rate limiting is process-local; horizontally scaled production readiness is blocked"
    );
  }
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true
  });
  await app.register(supabaseBoundaryPlugin);

  const dependencies = createApiDependencies(app, options);
  registerApiCloseHooks(app, dependencies);
  await registerApiHealthRoutes(app, dependencies);
  await registerApiRoutes(app, dependencies);
  await app.register(openApiPlugin);

  return app;
}

function allowedWebOrigins(webUrl: string, nodeEnv: "development" | "test" | "production") {
  const origins = new Set([webUrl]);
  const url = new URL(webUrl);
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
    origins.add(url.toString().replace(/\/$/, ""));
  } else if (url.hostname === "127.0.0.1") {
    url.hostname = "localhost";
    origins.add(url.toString().replace(/\/$/, ""));
  }

  if (nodeEnv !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://localhost:3008");
    origins.add("http://127.0.0.1:3008");
  }

  return [...origins];
}

function trustedProxySetting(value: string | undefined): false | string[] {
  if (!value) {
    return false;
  }

  const proxies = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (proxies.length === 0 || proxies.some((entry) => entry === "*" || entry === "true")) {
    throw new Error("API_TRUST_PROXY must contain explicit proxy IP addresses or CIDR ranges");
  }

  return proxies;
}
