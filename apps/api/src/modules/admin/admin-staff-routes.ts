import type { FastifyInstance } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { AdminRepositoryStateConflictError } from "./admin-repository.js";
import { isStaffRole } from "./admin-permissions.js";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { requireAdminAccess, requireAdminMutation } from "./admin-route-auth.js";
import type {
  AdminStaffInvitationRequest,
  AdminStaffMembershipActionRequest,
  StaffInvitationResponseRequest
} from "./types.js";

const recentAuthenticationWindowMs = 15 * 60 * 1000;

export function registerAdminStaffRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get(
    "/v1/admin/staff",
    { schema: contractRouteSchema("getAdminStaff") },
    async (request, reply) => {
      const allowed = await requireAdminAccess(request, reply, options, "admin.staff.read");
      if (!allowed) return reply;
      return reply.code(200).send(await options.adminRepository.getStaffDirectory());
    }
  );

  app.post(
    "/v1/admin/staff/invitations",
    {
      ...mutationRateLimit("adminMutation"),
      schema: contractRouteSchema("inviteAdminStaff")
    },
    async (request, reply) => {
      const mutation = await requireAdminMutation<AdminStaffInvitationRequest>(
        request,
        reply,
        options,
        { permission: "admin.staff.invite" },
        validateInvitation
      );
      if (!mutation) return reply;
      if (!isRecent(mutation.authenticatedAt)) {
        return reply.code(403).send({
          code: "recent_authentication_required",
          message: "Authenticate again before inviting a staff member"
        });
      }
      try {
        const invitation = await options.adminRepository.inviteStaff({
          supabaseUserId: mutation.supabaseUserId,
          targetUserId: mutation.body.targetUserId,
          role: mutation.body.role,
          expiresInHours: mutation.body.expiresInHours,
          reason: mutation.body.reason.trim(),
          idempotencyKey: mutation.idempotencyKey
        });
        if (!invitation) {
          return reply.code(404).send({ code: "not_found", message: "The target WeVid user was not found" });
        }
        return reply.code(201).send(invitation);
      } catch (error) {
        if (error instanceof AdminRepositoryStateConflictError) {
          return reply.code(409).send({ code: "conflict", message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/v1/admin/staff/memberships/:membershipId",
    {
      ...mutationRateLimit("adminMutation"),
      schema: contractRouteSchema("updateAdminStaffMembership")
    },
    async (request, reply) => {
      const body = request.body as Partial<AdminStaffMembershipActionRequest> | undefined;
      const permission = body?.action === "change_role"
        ? "admin.staff.change_role" as const
        : "admin.staff.revoke" as const;
      const mutation = await requireAdminMutation<AdminStaffMembershipActionRequest>(
        request,
        reply,
        options,
        { permission },
        validateMembershipAction
      );
      if (!mutation) return reply;
      if (!isRecent(mutation.authenticatedAt)) {
        return reply.code(403).send({
          code: "recent_authentication_required",
          message: "Authenticate again before changing staff access"
        });
      }
      const { membershipId } = request.params as { membershipId?: string };
      if (!membershipId) {
        return reply.code(404).send({ code: "not_found", message: "Staff membership was not found" });
      }
      try {
        const membership = await options.adminRepository.updateStaffMembership({
          supabaseUserId: mutation.supabaseUserId,
          membershipId,
          action: mutation.body.action,
          ...(mutation.body.role ? { role: mutation.body.role } : {}),
          reason: mutation.body.reason.trim(),
          idempotencyKey: mutation.idempotencyKey
        });
        if (!membership) {
          return reply.code(404).send({ code: "not_found", message: "Staff membership was not found" });
        }
        return reply.code(200).send(membership);
      } catch (error) {
        if (error instanceof AdminRepositoryStateConflictError) {
          return reply.code(409).send({ code: "conflict", message: error.message });
        }
        throw error;
      }
    }
  );

  app.get(
    "/v1/staff/invitations/current",
    { schema: contractRouteSchema("getCurrentStaffInvitations") },
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      return reply.code(200).send(
        await options.adminRepository.listCurrentStaffInvitations(session.supabaseUserId)
      );
    }
  );

  app.post(
    "/v1/staff/invitations/:invitationId/respond",
    {
      ...mutationRateLimit("adminMutation"),
      schema: contractRouteSchema("respondCurrentStaffInvitation")
    },
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) {
        return reply.code(400).send({ code: "validation_failed", message: "Idempotency-Key header is required" });
      }
      const { invitationId } = request.params as { invitationId?: string };
      const body = request.body as Partial<StaffInvitationResponseRequest> | undefined;
      if (!invitationId || !body || !["accept", "decline"].includes(body.decision ?? "")) {
        return reply.code(400).send({ code: "validation_failed", message: "A valid invitation decision is required" });
      }
      try {
        const invitation = await options.adminRepository.respondStaffInvitation({
          supabaseUserId: session.supabaseUserId,
          invitationId,
          decision: body.decision as StaffInvitationResponseRequest["decision"],
          idempotencyKey
        });
        if (!invitation) {
          return reply.code(404).send({ code: "not_found", message: "Staff invitation was not found" });
        }
        return reply.code(200).send(invitation);
      } catch (error) {
        if (error instanceof AdminRepositoryStateConflictError) {
          return reply.code(409).send({ code: "conflict", message: error.message });
        }
        throw error;
      }
    }
  );
}

function validateInvitation(body: Partial<AdminStaffInvitationRequest> | undefined): string | null {
  if (!body || typeof body.targetUserId !== "string" || !isStaffRole(body.role ?? "")) {
    return "An existing user ID and valid staff role are required";
  }
  if (!Number.isInteger(body.expiresInHours) || (body.expiresInHours ?? 0) < 1 || (body.expiresInHours ?? 0) > 168) {
    return "Invitation expiry must be between 1 and 168 hours";
  }
  if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500) {
    return "A reason between 3 and 500 characters is required";
  }
  return body.confirmed === true ? null : "Explicit confirmation is required";
}

function validateMembershipAction(body: Partial<AdminStaffMembershipActionRequest> | undefined): string | null {
  if (!body || !["change_role", "suspend", "revoke"].includes(body.action ?? "")) {
    return "A supported staff membership action is required";
  }
  if (body.action === "change_role" && !isStaffRole(body.role ?? "")) {
    return "A valid replacement role is required";
  }
  if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500) {
    return "A reason between 3 and 500 characters is required";
  }
  return body.confirmed === true ? null : "Explicit confirmation is required";
}

function isRecent(authenticatedAt: Date): boolean {
  return authenticatedAt.getTime() >= Date.now() - recentAuthenticationWindowMs;
}
