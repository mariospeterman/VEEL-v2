import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireIdempotencyKey as requireSharedIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ApplicationSessionVerifier } from "../session/types.js";
import { NotificationRepositoryConfigurationError } from "./notification-repository.js";
import type {
  NotificationRepository,
  NotificationPushConfig,
  RegisterNotificationDeviceRequest,
  UpdateNotificationPreferencesRequest
} from "./types.js";

interface RegisterNotificationRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  notificationRepository: NotificationRepository;
  vapidPublicKey?: string | undefined;
}

const deviceProviders = new Set(["web_push"]);
const devicePlatforms = new Set(["desktop", "ios", "android", "mobile_web"]);
const preferenceKeys = new Set([
  "messagesEnabled",
  "engagementEnabled",
  "liveEnabled",
  "paymentsEnabled",
  "membershipsEnabled",
  "eventAccessEnabled",
  "mutualsEnabled",
  "safetyEnabled",
  "walletEnabled",
  "creatorSetupEnabled",
  "studioSetupEnabled",
  "pushEnabled"
]);

export async function registerNotificationRoutes(
  app: FastifyInstance,
  options: RegisterNotificationRoutesOptions
): Promise<void> {
  app.get("/v1/notifications/push-config", async () => {
    const config: NotificationPushConfig = {
      enabled: Boolean(options.vapidPublicKey),
      vapidPublicKey: options.vapidPublicKey ?? null
    };

    return config;
  });

  app.get("/v1/notifications", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const query = request.query as { cursor?: string };

    return repositoryReply(request, reply, async () =>
      options.notificationRepository.listNotifications({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      })
    );
  });

  app.patch("/v1/notifications/:notificationId/read", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);
    const params = request.params as { notificationId?: string };
    if (!params.notificationId) return reply.code(400).send(validationResponse("notificationId is required"));

    try {
      const notification = await options.notificationRepository.markRead({
        supabaseUserId: access.supabaseUserId,
        notificationId: params.notificationId,
        idempotencyKey: request.headers["idempotency-key"] as string
      });

      if (!notification) {
        return reply.code(404).send({
          code: "not_found",
          message: "Notification not found"
        });
      }

      return reply.send(notification);
    } catch (error) {
      return repositoryErrorReply(request, reply, error);
    }
  });

  app.get("/v1/notifications/preferences", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    return repositoryReply(request, reply, async () =>
      options.notificationRepository.getPreferences({
        supabaseUserId: access.supabaseUserId
      })
    );
  });

  app.patch("/v1/notifications/preferences", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);

    const body = request.body as Partial<UpdateNotificationPreferencesRequest>;
    if (!validPreferencePatch(body)) {
      return reply.code(400).send(validationResponse("Notification preferences must be boolean values"));
    }

    return repositoryReply(request, reply, async () =>
      options.notificationRepository.updatePreferences({
        supabaseUserId: access.supabaseUserId,
        body,
        idempotencyKey: request.headers["idempotency-key"] as string
      })
    );
  });

  app.post("/v1/notifications/devices", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);

    const body = request.body as Partial<RegisterNotificationDeviceRequest>;
    if (
      !deviceProviders.has(body.provider ?? "") ||
      !devicePlatforms.has(body.platform ?? "") ||
      !body.endpoint ||
      !body.p256dh ||
      !body.auth
    ) {
      return reply.code(400).send(validationResponse("Valid web push endpoint and keys are required"));
    }

    return repositoryReply(
      request,
      reply,
      async () =>
        options.notificationRepository.registerDevice({
          supabaseUserId: access.supabaseUserId,
          body: body as RegisterNotificationDeviceRequest,
          idempotencyKey: request.headers["idempotency-key"] as string
        }),
      201
    );
  });

  app.delete("/v1/notifications/devices/:notificationDeviceId", async (request, reply) => {
    const access = await verifyNotificationAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);
    const params = request.params as { notificationDeviceId?: string };
    if (!params.notificationDeviceId) {
      return reply.code(400).send(validationResponse("notificationDeviceId is required"));
    }

    try {
      const deleted = await options.notificationRepository.deleteDevice({
        supabaseUserId: access.supabaseUserId,
        notificationDeviceId: params.notificationDeviceId,
        idempotencyKey: request.headers["idempotency-key"] as string
      });

      if (!deleted) {
        return reply.code(404).send({
          code: "not_found",
          message: "Notification device not found"
        });
      }

      return reply.code(202).send({ accepted: true });
    } catch (error) {
      return repositoryErrorReply(request, reply, error);
    }
  });
}

type NotificationAccessResult =
  | { ok: true; supabaseUserId: string }
  | {
      ok: false;
      statusCode: 401;
      body: { code: string; message: string };
    };

async function verifyNotificationAccess(
  request: FastifyRequest,
  options: RegisterNotificationRoutesOptions
): Promise<NotificationAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  return { ok: true, supabaseUserId: verifiedSession.supabaseUserId };
}

async function repositoryReply<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<T>,
  statusCode = 200
) {
  try {
    return reply.code(statusCode).send(await handler());
  } catch (error) {
    return repositoryErrorReply(request, reply, error);
  }
}

function repositoryErrorReply(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof NotificationRepositoryConfigurationError) {
    request.log.warn({ error }, "Notification repository is not configured");
    return reply.code(503).send({
      code: "provider_unavailable",
      message: "Notifications are not configured"
    });
  }

  throw error;
}

function validPreferencePatch(body: Partial<UpdateNotificationPreferencesRequest> | null | undefined): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  return Object.entries(body).every(([key, value]) => preferenceKeys.has(key) && typeof value === "boolean");
}

function requireIdempotencyKey(request: FastifyRequest): { code: string; message: string } | null {
  return requireSharedIdempotencyKey(request);
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
