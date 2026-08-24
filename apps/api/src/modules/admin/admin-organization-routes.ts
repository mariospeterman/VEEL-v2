import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { AdminRepositoryStateConflictError } from "./admin-repository.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { adminListInput, requireAdminAccess, requireAdminMutation } from "./admin-route-auth.js";
import { validateFeatureFlagPatch, validateOrganizationKybAction, validateOrganizationMemberAction, validateOrganizationProvision } from "./admin-route-validators.js";
import type { AdminFeatureFlagPatchRequest, AdminOrganizationKybActionRequest, AdminOrganizationMemberActionRequest, AdminOrganizationProvisionRequest } from "./types.js";

export function registerAdminOrganizationRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/organizations", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.organizations.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listOrganizations(adminListInput(query)));
  });

  app.post("/v1/admin/organizations", mutationRateLimit("adminMutation"), async (request, reply) => {
    const mutation = await requireAdminMutation<AdminOrganizationProvisionRequest>(
      request,
      reply,
      options,
      { permission: "admin.organizations.write" },
      validateOrganizationProvision
    );
    if (!mutation) return reply;

    try {
      const body = {
        name: mutation.body.name.trim(),
        ownerHandle: mutation.body.ownerHandle.trim().toLowerCase(),
        reason: mutation.body.reason.trim()
      };
      const organization = await options.adminRepository.provisionOrganization({
        supabaseUserId: mutation.supabaseUserId,
        body,
        idempotencyKey: mutation.idempotencyKey,
        requestHash: createHash("sha256").update(JSON.stringify(body)).digest("hex")
      });
      if (!organization) {
        return reply.code(404).send({ code: "not_found", message: "Owner account was not found" });
      }
      return reply.code(201).send(organization);
    } catch (error) {
      if (error instanceof AdminRepositoryStateConflictError) {
        return reply.code(409).send({ code: "conflict", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/v1/admin/organizations/:organizationId/kyb", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { organizationId } = request.params as { organizationId?: string };
    if (!organizationId) {
      return reply.code(404).send({
        code: "not_found",
        message: "Organization was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminOrganizationKybActionRequest>(
      request,
      reply,
      options,
      { permission: "admin.organizations.write" },
      validateOrganizationKybAction
    );
    if (!mutation) return reply;

    const organization = await options.adminRepository.updateOrganizationKyb({
      supabaseUserId: mutation.supabaseUserId,
      organizationId,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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
    const allowed = await requireAdminAccess(request, reply, options, "admin.organizations.read");
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

  app.patch("/v1/admin/organizations/:organizationId/members/:membershipId", mutationRateLimit("adminMutation"), async (request, reply) => {
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

    const mutation = await requireAdminMutation<AdminOrganizationMemberActionRequest>(
      request,
      reply,
      options,
      { permission: "admin.organizations.write" },
      validateOrganizationMemberAction
    );
    if (!mutation) return reply;

    try {
      const member = await options.adminRepository.updateOrganizationMember({
        supabaseUserId: mutation.supabaseUserId,
        organizationId,
        membershipId,
        body: mutation.body,
        idempotencyKey: mutation.idempotencyKey
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
    const allowed = await requireAdminAccess(request, reply, options, "admin.feature_flags.read");
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.listFeatureFlags());
  });

  app.patch("/v1/admin/feature-flags/:featureFlagKey", mutationRateLimit("adminMutation"), async (request, reply) => {
    const { featureFlagKey } = request.params as { featureFlagKey?: string };
    if (!featureFlagKey) {
      return reply.code(404).send({
        code: "not_found",
        message: "Feature flag was not found"
      });
    }

    const mutation = await requireAdminMutation<AdminFeatureFlagPatchRequest>(
      request,
      reply,
      options,
      { permission: "admin.feature_flags.write" },
      validateFeatureFlagPatch
    );
    if (!mutation) return reply;

    const featureFlag = await options.adminRepository.updateFeatureFlag({
      supabaseUserId: mutation.supabaseUserId,
      featureFlagKey,
      body: mutation.body,
      idempotencyKey: mutation.idempotencyKey
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
