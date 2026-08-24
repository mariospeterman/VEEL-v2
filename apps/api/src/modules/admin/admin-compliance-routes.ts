import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { adminListInput, featureFlagEnabled, requireAdminAccess } from "./admin-route-auth.js";

export function registerAdminComplianceRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/compliance/ledger", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listComplianceLedger(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/dac7/reports", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listDac7Reports(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/carf/reports", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
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
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listVatDeterminations(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/receipts", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listReceipts(adminListInput(query)));
  });

  app.get("/v1/admin/compliance/invoices", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.compliance.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listInvoices(adminListInput(query)));
  });

  app.get("/v1/admin/referrals/programs", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.payments.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listReferralPrograms(adminListInput(query)));
  });

  app.get("/v1/admin/referrals/partner-campaigns", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.payments.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listPartnerCampaigns(adminListInput(query)));
  });

  app.get("/v1/admin/tier-waivers", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.payments.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listTierWaivers(adminListInput(query)));
  });
}
