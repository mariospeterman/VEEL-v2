import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { adminListInput, requireAdminAccess, requireAdminMutation } from "./admin-route-auth.js";
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

  app.patch("/v1/admin/support/cases/:supportCaseId", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { supportCaseId } = request.params as { supportCaseId?: string };
    if (!supportCaseId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support case was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminSupportCaseActionRequest>(
      request,
      reply,
      options,
      { action: "support_case_updated" },
      validateSupportCaseAction
    );
    if (!mutation) return reply;

    const supportCase = await options.adminRepository.updateSupportCase({
      supabaseUserId: mutation.supabaseUserId,
      supportCaseId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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

  app.patch("/v1/admin/support/policies/:supportPolicyId", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { supportPolicyId } = request.params as { supportPolicyId?: string };
    if (!supportPolicyId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Support policy was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminSupportPolicyActionRequest>(
      request,
      reply,
      options,
      { action: "organization_support_policy_updated" },
      validateSupportPolicyAction
    );
    if (!mutation) return reply;

    const supportPolicy = await options.adminRepository.updateSupportPolicy({
      supabaseUserId: mutation.supabaseUserId,
      supportPolicyId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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

  app.patch("/v1/admin/refunds/disputes/:refundDisputeId", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { refundDisputeId } = request.params as { refundDisputeId?: string };
    if (!refundDisputeId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Refund or dispute request was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminRefundDisputeActionRequest>(
      request,
      reply,
      options,
      { action: "refund_dispute_updated" },
      validateRefundDisputeAction
    );
    if (!mutation) return reply;

    const dispute = await options.adminRepository.updateRefundDispute({
      supabaseUserId: mutation.supabaseUserId,
      refundDisputeId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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

  app.patch("/v1/admin/data-requests/:dataRequestId", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { dataRequestId } = request.params as { dataRequestId?: string };
    if (!dataRequestId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Data request was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminDataRequestActionRequest>(
      request,
      reply,
      options,
      { action: "data_request_updated" },
      validateDataRequestAction
    );
    if (!mutation) return reply;

    const dataRequest = await options.adminRepository.updateDataRequest({
      supabaseUserId: mutation.supabaseUserId,
      dataRequestId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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
