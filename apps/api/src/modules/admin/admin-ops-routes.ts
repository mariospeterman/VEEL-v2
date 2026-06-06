import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { adminListInput, requireAdminAccess, requireAdminAccessWithUser } from "./admin-route-auth.js";
import { validateAdminReason } from "./admin-route-validators.js";
import type { AdminReasonRequest } from "./types.js";

export function registerAdminOpsRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/ops/summary", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getOpsSummary());
  });

  app.get("/v1/admin/notifications/health", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getNotificationHealth());
  });


  app.get("/v1/admin/payments/intents", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listPaymentIntents(adminListInput(query)));
  });

  app.get("/v1/admin/unlocks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listUnlocks(adminListInput(query)));
  });

  app.get("/v1/admin/provider-events", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listProviderEvents(adminListInput(query)));
  });

  app.post("/v1/admin/provider-events/:providerEventId/replay", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
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
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAuditEvents(adminListInput(query)));
  });

}
