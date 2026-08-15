import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
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
  app.setErrorHandler((error, request, reply) => {
    const validationError = error as {
      validation?: unknown;
      validationContext?: unknown;
    };
    if (Array.isArray(validationError.validation)) {
      request.log.info(
        { validationContext: validationError.validationContext },
        "API contract validation rejected request"
      );
      return reply.code(400).send({
        code: "validation_failed",
        message: "Request does not match the API contract"
      });
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode <= 599) {
      if ((error as { code?: unknown }).code === "rate_limited") {
        return reply.code(statusCode).send({
          code: "rate_limited",
          message: "Too many requests"
        });
      }
      return reply.code(statusCode).send(error);
    }
    return reply.send(error);
  });
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

  if (app.config.API_RATE_LIMIT_STORE_DRIVER === "redis" && !app.config.API_RATE_LIMIT_REDIS_URL) {
    throw new Error("API_RATE_LIMIT_STORE_DRIVER=redis requires API_RATE_LIMIT_REDIS_URL");
  }

  if (app.config.NODE_ENV === "production" && app.config.API_RATE_LIMIT_STORE_DRIVER === "process_memory") {
    throw new Error("Production requires a distributed API rate-limit store");
  }

  const rateLimitRedis = app.config.API_RATE_LIMIT_STORE_DRIVER === "redis"
    ? new Redis(app.config.API_RATE_LIMIT_REDIS_URL as string, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false
      })
    : undefined;

  if (rateLimitRedis) {
    await rateLimitRedis.connect();
    app.addHook("onClose", async () => {
      rateLimitRedis.disconnect();
    });
  }

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    skipOnError: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: "rate_limited",
      message: "Too many requests"
    }),
    ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
    ...(options.rateLimitStore ? { store: options.rateLimitStore } : {})
  });
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
