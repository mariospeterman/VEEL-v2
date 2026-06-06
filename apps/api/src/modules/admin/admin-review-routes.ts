import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { adminListInput, requireAdminAccess, requireAdminAccessWithUser } from "./admin-route-auth.js";
import { validateDataRequestAction, validateRefundDisputeAction, validateSupportCaseAction, validateSupportPolicyAction } from "./admin-route-validators.js";
import type { AdminDataRequestActionRequest, AdminRefundDisputeActionRequest, AdminSupportCaseActionRequest, AdminSupportPolicyActionRequest } from "./types.js";

export function registerAdminReviewRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/support/cases", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listSupportCases(adminListInput(query)));
  });

  app.patch("/v1/admin/support/cases/:supportCaseId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { supportCaseId } = request.params as { supportCaseId?: string };
    if (!supportCaseId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support case was not found"
      });
    }

    const body = request.body as Partial<AdminSupportCaseActionRequest> | undefined;
    const validationError = validateSupportCaseAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const supportCase = await options.adminRepository.updateSupportCase({
      supabaseUserId: access.supabaseUserId,
      supportCaseId,
      body: body as AdminSupportCaseActionRequest,
      idempotencyKey
    });

    if (!supportCase) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support case was not found"
      });
    }

    return reply.code(200).send(supportCase);
  });

  app.get("/v1/admin/support/policies", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listSupportPolicies(adminListInput(query)));
  });

  app.patch("/v1/admin/support/policies/:supportPolicyId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { supportPolicyId } = request.params as { supportPolicyId?: string };
    if (!supportPolicyId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support policy was not found"
      });
    }

    const body = request.body as Partial<AdminSupportPolicyActionRequest> | undefined;
    const validationError = validateSupportPolicyAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const supportPolicy = await options.adminRepository.updateSupportPolicy({
      supabaseUserId: access.supabaseUserId,
      supportPolicyId,
      body: body as AdminSupportPolicyActionRequest,
      idempotencyKey
    });

    if (!supportPolicy) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support policy was not found"
      });
    }

    return reply.code(200).send(supportPolicy);
  });

  app.get("/v1/admin/refunds/disputes", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listRefundDisputes(adminListInput(query)));
  });

  app.patch("/v1/admin/refunds/disputes/:refundDisputeId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { refundDisputeId } = request.params as { refundDisputeId?: string };
    if (!refundDisputeId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Refund or dispute request was not found"
      });
    }

    const body = request.body as Partial<AdminRefundDisputeActionRequest> | undefined;
    const validationError = validateRefundDisputeAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const dispute = await options.adminRepository.updateRefundDispute({
      supabaseUserId: access.supabaseUserId,
      refundDisputeId,
      body: body as AdminRefundDisputeActionRequest,
      idempotencyKey
    });

    if (!dispute) {
      return reply.code(404).send({
        code: "not_found",
        message: "Refund or dispute request was not found"
      });
    }

    return reply.code(200).send(dispute);
  });

  app.get("/v1/admin/data-requests", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listDataRequests(adminListInput(query)));
  });

  app.patch("/v1/admin/data-requests/:dataRequestId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { dataRequestId } = request.params as { dataRequestId?: string };
    if (!dataRequestId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Data request was not found"
      });
    }

    const body = request.body as Partial<AdminDataRequestActionRequest> | undefined;
    const validationError = validateDataRequestAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const dataRequest = await options.adminRepository.updateDataRequest({
      supabaseUserId: access.supabaseUserId,
      dataRequestId,
      body: body as AdminDataRequestActionRequest,
      idempotencyKey
    });

    if (!dataRequest) {
      return reply.code(404).send({
        code: "not_found",
        message: "Data request was not found"
      });
    }

    return reply.code(200).send(dataRequest);
  });

}
