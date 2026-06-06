import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import { AdminRepositoryConfigurationError } from "./admin-repository.js";
import type { AdminOrganizationKybActionRequest, AdminRepository } from "./types.js";

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

  app.get("/v1/admin/dating/safety", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getDatingSafety());
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
