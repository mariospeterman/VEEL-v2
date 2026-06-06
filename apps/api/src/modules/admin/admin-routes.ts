import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import {
  AdminRepositoryConfigurationError,
  AdminRepositoryStateConflictError
} from "./admin-repository.js";
import type {
  AccessPass,
  AdminModerationActionRequest,
  AdminOrganizationKybActionRequest,
  AdminOrganizationMemberActionRequest,
  AdminDataRequestActionRequest,
  AdminFeatureFlagPatchRequest,
  AdminRefundDisputeActionRequest,
  AdminReasonRequest,
  AdminReportActionRequest,
  AdminRepository,
  Ticket,
  AdminSupportCaseActionRequest,
  AdminSupportPolicyActionRequest
} from "./types.js";

interface RegisterAdminRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  adminRepository: AdminRepository;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): Promise<void> {
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

  app.get("/v1/admin/events", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listEvents(adminListInput(query)));
  });

  const listEventAccessPasses = async (
    request: FastifyRequest,
    reply: FastifyReply,
    responseShape: "access_pass" | "ticket"
  ) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    const page = await options.adminRepository.listTickets(adminListInput(query));
    const response =
      responseShape === "ticket"
        ? page
        : {
            items: page.items.map(toAccessPass),
            nextCursor: page.nextCursor
          };

    return reply.code(200).send(response);
  };

  app.get("/v1/admin/event-access-passes", (request, reply) =>
    listEventAccessPasses(request, reply, "access_pass")
  );
  app.get("/v1/admin/tickets", (request, reply) => listEventAccessPasses(request, reply, "ticket"));

  app.get("/v1/admin/live/rooms", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listLiveRooms(adminListInput(query)));
  });

  app.get("/v1/admin/media/assets", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listMediaAssets(adminListInput(query)));
  });

  app.get("/v1/admin/age-kyc/age-checks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAgeChecks(adminListInput(query)));
  });

  app.get("/v1/admin/age-kyc/identity-checks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listIdentityChecks(adminListInput(query)));
  });

  app.get("/v1/admin/ai/sessions", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAiSessions(adminListInput(query)));
  });

  app.get("/v1/admin/ai/tool-calls", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAiToolCalls(adminListInput(query)));
  });

  async function getMutualsSafety(request: FastifyRequest, reply: FastifyReply) {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getMutualsSafety());
  }

  app.get("/v1/admin/mutuals/safety", getMutualsSafety);

  app.get("/v1/admin/dating/safety", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const safety = await options.adminRepository.getMutualsSafety();
    return reply.code(200).send({
      openReports: safety.openReports,
      activeMatches: safety.activeMutuals,
      staleMatches: safety.staleMutuals
    });
  });

  app.get("/v1/admin/compliance/ledger", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listComplianceLedger(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/dac7/reports", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listDac7Reports(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/carf/reports", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const enabled = await featureFlagEnabled(options.adminRepository, "compliance.carf_exports");
    if (!enabled) {
      return reply.code(403).send({
        code: "forbidden",
        message: "CARF reporting is disabled by policy"
      });
    }

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listCarfReports(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/vat/determinations", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listVatDeterminations(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/receipts", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listReceipts(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/invoices", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listInvoices(adminListInput(query)));
  });

  app.get("/v1/admin/referrals/programs", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listReferralPrograms(adminListInput(query)));
  });

  app.get("/v1/admin/referrals/partner-campaigns", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listPartnerCampaigns(adminListInput(query)));
  });

  app.get("/v1/admin/tier-waivers", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listTierWaivers(adminListInput(query)));
  });

  app.get("/v1/admin/organizations", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listOrganizations(adminListInput(query)));
  });

  app.patch("/v1/admin/organizations/:organizationId/kyb", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { organizationId } = request.params as { organizationId?: string };
    if (!organizationId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Organization was not found"
      });
    }

    const body = request.body as Partial<AdminOrganizationKybActionRequest> | undefined;
    const validationError = validateOrganizationKybAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const organization = await options.adminRepository.updateOrganizationKyb({
      supabaseUserId: access.supabaseUserId,
      organizationId,
      body: body as AdminOrganizationKybActionRequest,
      idempotencyKey
    });

    if (!organization) {
      return reply.code(404).send({
        code: "not_found",
        message: "Organization was not found"
      });
    }

    return reply.code(200).send(organization);
  });

  app.get("/v1/admin/organizations/:organizationId/members", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    const { organizationId } = request.params as { organizationId?: string };
    if (!organizationId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Organization was not found"
      });
    }

    const query = request.query as { cursor?: string };
    return reply.code(200).send(
      await options.adminRepository.listOrganizationMembers({
        organizationId,
        ...(query.cursor ? { cursor: query.cursor } : {})
      })
    );
  });

  app.patch("/v1/admin/organizations/:organizationId/members/:membershipId", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { membershipId, organizationId } = request.params as {
      membershipId?: string;
      organizationId?: string;
    };
    if (!membershipId || !organizationId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Organization member was not found"
      });
    }

    const body = request.body as Partial<AdminOrganizationMemberActionRequest> | undefined;
    const validationError = validateOrganizationMemberAction(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    try {
      const member = await options.adminRepository.updateOrganizationMember({
        supabaseUserId: access.supabaseUserId,
        organizationId,
        membershipId,
        body: body as AdminOrganizationMemberActionRequest,
        idempotencyKey
      });

      if (!member) {
        return reply.code(404).send({
          code: "not_found",
          message: "Organization member was not found"
        });
      }

      return reply.code(200).send(member);
    } catch (error) {
      if (error instanceof AdminRepositoryStateConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.get("/v1/admin/feature-flags", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.listFeatureFlags());
  });

  app.patch("/v1/admin/feature-flags/:featureFlagKey", async (request, reply) => {
    const access = await requireAdminAccessWithUser(request, reply, options);
    if (!access) return reply;

    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const { featureFlagKey } = request.params as { featureFlagKey?: string };
    if (!featureFlagKey) {
      return reply.code(404).send({
        code: "not_found",
        message: "Feature flag was not found"
      });
    }

    const body = request.body as Partial<AdminFeatureFlagPatchRequest> | undefined;
    const validationError = validateFeatureFlagPatch(body);
    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const featureFlag = await options.adminRepository.updateFeatureFlag({
      supabaseUserId: access.supabaseUserId,
      featureFlagKey,
      body: body as AdminFeatureFlagPatchRequest,
      idempotencyKey
    });

    if (!featureFlag) {
      return reply.code(404).send({
        code: "not_found",
        message: "Feature flag was not found"
      });
    }

    return reply.code(200).send(featureFlag);
  });
}

function adminListInput(query: { q?: string; cursor?: string }): { query?: string; cursor?: string } {
  return {
    ...(query.q ? { query: query.q } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {})
  };
}

async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions
): Promise<boolean> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return false;
  }

  try {
    const allowed = await options.adminRepository.hasAdminAccess(verifiedSession.supabaseUserId);

    if (!allowed) {
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is required"
      });
      return false;
    }

    return true;
  } catch (error) {
    if (error instanceof AdminRepositoryConfigurationError) {
      request.log.warn({ error }, "Admin repository is not configured");
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is not configured"
      });
      return false;
    }

    throw error;
  }
}

async function requireAdminAccessWithUser(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions
): Promise<{ supabaseUserId: string } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  try {
    const allowed = await options.adminRepository.hasAdminAccess(verifiedSession.supabaseUserId);

    if (!allowed) {
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is required"
      });
      return null;
    }

    return {
      supabaseUserId: verifiedSession.supabaseUserId
    };
  } catch (error) {
    if (error instanceof AdminRepositoryConfigurationError) {
      request.log.warn({ error }, "Admin repository is not configured");
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is not configured"
      });
      return null;
    }

    throw error;
  }
}

function validateOrganizationKybAction(
  body: Partial<AdminOrganizationKybActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.kybState !== "not_started" &&
    body.kybState !== "pending" &&
    body.kybState !== "verified" &&
    body.kybState !== "rejected"
  ) {
    return "kybState is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateAdminReason(body: Partial<AdminReasonRequest> | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateModerationAction(
  body: Partial<AdminModerationActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.action !== "approve" &&
    body.action !== "restrict" &&
    body.action !== "block" &&
    body.action !== "delete" &&
    body.action !== "reinstate"
  ) {
    return "action is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateReportAction(
  body: Partial<AdminReportActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "reviewing" &&
    body.state !== "resolved" &&
    body.state !== "escalated" &&
    body.state !== "rejected"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateSupportCaseAction(
  body: Partial<AdminSupportCaseActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "open" &&
    body.state !== "pending_user" &&
    body.state !== "pending_internal" &&
    body.state !== "resolved" &&
    body.state !== "closed"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateSupportPolicyAction(
  body: Partial<AdminSupportPolicyActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.supportState !== "standard" &&
    body.supportState !== "priority" &&
    body.supportState !== "enterprise_review"
  ) {
    return "supportState is invalid";
  }

  if (body.slaTier !== "standard" && body.slaTier !== "priority" && body.slaTier !== "enterprise_review") {
    return "slaTier is invalid";
  }

  if (body.state !== "active" && body.state !== "paused" && body.state !== "review_required") {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateRefundDisputeAction(
  body: Partial<AdminRefundDisputeActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "opened" &&
    body.state !== "reviewing" &&
    body.state !== "creator_action_required" &&
    body.state !== "rejected" &&
    body.state !== "withdrawn" &&
    body.state !== "resolved" &&
    body.state !== "closed"
  ) {
    return "state is invalid";
  }

  if (!body.resolution || body.resolution.trim().length < 3 || body.resolution.length > 1000) {
    return "resolution must be 3-1000 characters";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateDataRequestAction(
  body: Partial<AdminDataRequestActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "verifying" &&
    body.state !== "processing" &&
    body.state !== "completed" &&
    body.state !== "rejected"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

function validateFeatureFlagPatch(
  body: Partial<AdminFeatureFlagPatchRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return "value must be an object";
  }

  if (body.state !== "active" && body.state !== "paused" && body.state !== "archived") {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

async function featureFlagEnabled(repository: AdminRepository, key: string): Promise<boolean> {
  const flags = await repository.listFeatureFlags();
  const flag = flags.items.find((item) => item.key === key);

  if (!flag || flag.state !== "active") {
    return false;
  }

  if (typeof flag.value !== "object" || flag.value === null || Array.isArray(flag.value)) {
    return false;
  }

  return (flag.value as { enabled?: unknown }).enabled === true;
}

function toAccessPass(ticket: Ticket): AccessPass {
  return {
    id: ticket.id,
    eventId: ticket.eventId,
    accessPassTypeId: ticket.ticketTypeId,
    holderUserId: ticket.holderUserId,
    state: ticket.state,
    qrToken: ticket.qrToken,
    createdAt: ticket.createdAt,
    ...(ticket.paymentIntentId !== undefined ? { paymentIntentId: ticket.paymentIntentId } : {}),
    ...(ticket.checkedInAt !== undefined ? { checkedInAt: ticket.checkedInAt } : {})
  };
}

function validateOrganizationMemberAction(
  body: Partial<AdminOrganizationMemberActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.role !== "owner" &&
    body.role !== "admin" &&
    body.role !== "member" &&
    body.role !== "viewer"
  ) {
    return "role is invalid";
  }

  if (
    body.state !== "invited" &&
    body.state !== "active" &&
    body.state !== "suspended" &&
    body.state !== "removed"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}
