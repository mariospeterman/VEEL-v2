import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { adminListInput, requireAdminAccess, requireAdminMutation } from "./admin-route-auth.js";
import { validateModerationAction, validateReportAction } from "./admin-route-validators.js";
import type { AdminModerationActionRequest, AdminReportActionRequest } from "./types.js";
import { AdminRepositoryStateConflictError } from "./admin-repository.js";

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

  app.patch("/v1/admin/content/:contentId/moderation", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { contentId } = request.params as { contentId?: string };
    if (!contentId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Content was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminModerationActionRequest>(
      request,
      reply,
      options,
      { action: "content_moderation_updated" },
      validateModerationAction
    );
    if (!mutation) return reply;

    let content;
    try {
      content = await options.adminRepository.updateContentModeration({
        supabaseUserId: mutation.supabaseUserId,
        contentId,
        body: mutation.body,
        idempotencyKey: mutation.idempotencyKey
      });
    } catch (error) {
      if (error instanceof AdminRepositoryStateConflictError) {
        return reply.code(409).send({ code: "conflict", message: error.message });
      }
      throw error;
    }

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

  app.patch("/v1/admin/reports/:reportId", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { reportId } = request.params as { reportId?: string };
    if (!reportId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Report was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminReportActionRequest>(
      request,
      reply,
      options,
      { action: "report_review_updated" },
      validateReportAction
    );
    if (!mutation) return reply;

    const report = await options.adminRepository.updateReport({
      supabaseUserId: mutation.supabaseUserId,
      reportId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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
