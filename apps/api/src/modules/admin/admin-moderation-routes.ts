import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { adminListInput, requireAdminAccess, requireAdminAccessWithUser } from "./admin-route-auth.js";
import { validateModerationAction, validateReportAction } from "./admin-route-validators.js";
import type { AdminModerationActionRequest, AdminReportActionRequest } from "./types.js";

export function registerAdminModerationRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/users", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { q?: string; cursor?: string };
    return reply.code(200).send(await options.adminRepository.listUsers(adminListInput(query)));
  });

  app.get("/v1/admin/users/:userId", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const { userId } = request.params as { userId?: string };
    if (!userId) {
      return reply.code(404).send({
        code: "not_found",
        message: "User was not found"
      });
    }

    const user = await options.adminRepository.getUser({ userId });
    if (!user) {
      return reply.code(404).send({
        code: "not_found",
        message: "User was not found"
      });
    }

    return reply.code(200).send(user);
  });

  app.get("/v1/admin/content", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listContent(adminListInput(query)));
  });

  app.patch("/v1/admin/content/:contentId/moderation", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { contentId } = request.params as { contentId?: string };
    if (!contentId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Content was not found"
      });
    }

    const body = request.body as Partial<AdminModerationActionRequest> | undefined;
    const validationError = validateModerationAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const content = await options.adminRepository.updateContentModeration({
      supabaseUserId: access.supabaseUserId,
      contentId,
      body: body as AdminModerationActionRequest,
      idempotencyKey
    });

    if (!content) {
      return reply.code(404).send({
        code: "not_found",
        message: "Content was not found"
      });
    }

    return reply.code(200).send(content);
  });

  app.get("/v1/admin/reports", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listReports(adminListInput(query)));
  });

  app.patch("/v1/admin/reports/:reportId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { reportId } = request.params as { reportId?: string };
    if (!reportId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Report was not found"
      });
    }

    const body = request.body as Partial<AdminReportActionRequest> | undefined;
    const validationError = validateReportAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const report = await options.adminRepository.updateReport({
      supabaseUserId: access.supabaseUserId,
      reportId,
      body: body as AdminReportActionRequest,
      idempotencyKey
    });

    if (!report) {
      return reply.code(404).send({
        code: "not_found",
        message: "Report was not found"
      });
    }

    return reply.code(200).send(report);
  });

}
