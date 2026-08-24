import type { FastifyInstance } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { adminListInput, requireAdminAccess, requireAdminAccessWithUser } from "./admin-route-auth.js";
import { validateAdminReason } from "./admin-route-validators.js";
import type { AdminReasonRequest, AdminWorkerQueueName } from "./types.js";

const workerQueueNames = new Set<AdminWorkerQueueName>([
  "subscription_collections",
  "notification_deliveries",
  "payment_confirmation_emails",
  "provider_event_replays",
  "media_moderation",
  "analytics_projections",
  "live_safety"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerAdminOpsRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/me", { schema: contractRouteSchema("getAdminCurrentStaff") }, async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options, {
      permission: "admin.overview.read"
    });
    if (!access) return reply;
    const staff = await options.adminRepository.getStaffAccess(access.supabaseUserId);
    if (!staff) return reply.code(403).send({ code: "forbidden", message: "Staff access is not active" });
    return reply.code(200).send(staff);
  });

  app.get("/v1/admin/ops/summary", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.overview.read");
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getOpsSummary());
  });

  app.get("/v1/admin/notifications/health", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.queues.read");
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getNotificationHealth());
  });

  app.post("/v1/admin/worker-queues/:queueName/jobs/:jobId/retry", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options, {
      permission: "admin.queues.retry",
      mutation: true,
      reasonRequired: true
    });
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const params = request.params as { queueName?: string; jobId?: string };
    if (
      !workerQueueNames.has(params.queueName as AdminWorkerQueueName) ||
      !params.jobId ||
      !uuidPattern.test(params.jobId)
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "A supported queue name and job ID are required"
      });
    }

    const body = request.body as Partial<AdminReasonRequest> | undefined;
    const validationError = validateAdminReason(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const accepted = await options.adminRepository.retryDeadLetterJob({
      supabaseUserId: access.supabaseUserId,
      queueName: params.queueName as AdminWorkerQueueName,
      jobId: params.jobId,
      body: body as AdminReasonRequest,
      idempotencyKey
    });

    if (!accepted) {
      return reply.code(404).send({
        code: "not_found",
        message: "Dead-letter worker job was not found"
      });
    }

    return reply.code(202).send();
  });


  app.get("/v1/admin/payments/intents", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.payments.read");
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listPaymentIntents(adminListInput(query)));
  });

  app.get("/v1/admin/unlocks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.payments.read");
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listUnlocks(adminListInput(query)));
  });

  app.get("/v1/admin/provider-events", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.providers.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listProviderEvents(adminListInput(query)));
  });

  app.post("/v1/admin/provider-events/:providerEventId/replay", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options, {
      permission: "admin.provider_events.replay",
      mutation: true,
      reasonRequired: true
    });
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<AdminReasonRequest> | undefined;
    const validationError = validateAdminReason(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const providerEventId = (request.params as { providerEventId?: string }).providerEventId ?? "";
    const queued = await options.adminRepository.enqueueProviderEventReplay({
      supabaseUserId: access.supabaseUserId,
      providerEventId,
      body: body as AdminReasonRequest,
      idempotencyKey
    });

    if (!queued) {
      return reply.code(404).send({
        code: "not_found",
        message: "Provider event was not found"
      });
    }

    return reply.code(202).send();
  });

  app.get("/v1/admin/audit", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.audit.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAuditEvents(adminListInput(query)));
  });

}
