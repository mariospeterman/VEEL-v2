import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { AdminRepositoryStateConflictError } from "./admin-repository.js";
import { adminListInput, requireAdminAccess, requireAdminAccessWithUser } from "./admin-route-auth.js";
import { validateFeatureFlagPatch, validateOrganizationKybAction, validateOrganizationMemberAction } from "./admin-route-validators.js";
import type { AdminFeatureFlagPatchRequest, AdminOrganizationKybActionRequest, AdminOrganizationMemberActionRequest } from "./types.js";

export function registerAdminOrganizationRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
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
