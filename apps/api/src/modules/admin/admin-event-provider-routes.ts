import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { components } from "@veel/contracts";
import { hasRecentAuthentication } from "../auth/http-auth.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import {
  LiveControlIdempotencyConflictError,
  LiveRepositoryConfigurationError
} from "../live/live-repository.js";
import { LiveProviderError, LiveProviderRequestError } from "../live/livepeer-adapter.js";
import { hashLiveRequest } from "../live/live-route-shared.js";
import {
  adminListInput,
  requireAdminAccess,
  requireAdminMutation,
  type RegisterAdminRoutesOptions
} from "./admin-route-auth.js";

type AdminLiveRoomSuspensionRequest = components["schemas"]["AdminLiveRoomSuspensionRequest"];

export function registerAdminEventProviderRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/events", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.events.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listEvents(adminListInput(query)));
  });

  const listEventAccessPasses = async (request: FastifyRequest, reply: FastifyReply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.events.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAccessPasses(adminListInput(query)));
  };

  app.get("/v1/admin/event-access-passes", listEventAccessPasses);

  app.get("/v1/admin/live/rooms", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.live.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listLiveRooms(adminListInput(query)));
  });

  app.post(
    "/v1/admin/live/rooms/:roomId/suspension",
    mutationRateLimit("adminMutation", "updateAdminLiveRoomSuspension"),
    async (request, reply) => {
      const requestedBody = request.body as Partial<AdminLiveRoomSuspensionRequest> | undefined;
      const mutation = await requireAdminMutation<AdminLiveRoomSuspensionRequest>(
        request,
        reply,
        options,
        {
          permission: requestedBody?.suspended === false ? "admin.live.resume" : "admin.live.suspend",
          mutation: true,
          reasonRequired: true
        },
        validateLiveSuspension
      );
      if (!mutation) return reply;
      if (!hasRecentAuthentication(mutation.authenticatedAt)) {
        return reply.code(403).send({
          code: "recent_authentication_required",
          message: "Authenticate again before changing live safety controls"
        });
      }

      const roomId = (request.params as { roomId?: string }).roomId ?? "";
      let control: Awaited<ReturnType<typeof options.liveRepository.reserveStaffControl>> = null;
      try {
        control = await options.liveRepository.reserveStaffControl({
          supabaseUserId: mutation.supabaseUserId,
          roomId,
          action: mutation.body.suspended ? "staff_suspended" : "staff_resumed",
          reason: mutation.body.reason.trim(),
          idempotencyKey: mutation.idempotencyKey,
          requestHash: hashLiveRequest({ roomId, ...mutation.body, reason: mutation.body.reason.trim() })
        });
        if (!control) {
          return reply.code(403).send({
            code: "forbidden",
            message: "Live safety control requires an authorized trust-and-safety role"
          });
        }
        if (control.state === "completed") return reply.code(202).send();

        await options.liveProvider.setRoomSuspended({
          providerStreamId: control.providerStreamId,
          suspended: mutation.body.suspended
        });

        let nextState: "suspended" | "waiting" | "live" | "ended" = "suspended";
        let providerState = "suspended";
        if (!mutation.body.suspended) {
          const status = await options.liveProvider.getRoomStatus({
            providerStreamId: control.providerStreamId,
            providerPlaybackId: null
          });
          nextState = status.state === "live" ? "live" : status.state === "ended" ? "ended" : "waiting";
          providerState = status.providerState;
        }

        await options.liveRepository.completeControl({
          controlId: control.id,
          state: nextState,
          providerState
        });
        return reply.code(202).send();
      } catch (error) {
        if (error instanceof LiveControlIdempotencyConflictError) {
          return reply.code(409).send({ code: "conflict", message: "Idempotency key was already used" });
        }
        if (error instanceof LiveProviderError && control) {
          await options.liveRepository.failControl({
            controlId: control.id,
            providerFailureKind: error instanceof LiveProviderRequestError ? error.kind : "configuration",
            providerStatusCode: error instanceof LiveProviderRequestError ? error.statusCode : null
          });
          request.log.warn({ roomId, providerFailure: true }, "Live safety provider control failed");
          return reply.code(503).send({
            code: "service_unavailable",
            message: mutation.body.suspended
              ? "The room is blocked locally; provider suspension will be retried"
              : "The room remains suspended until provider recovery succeeds"
          });
        }
        if (error instanceof LiveRepositoryConfigurationError) {
          return reply.code(503).send({ code: "service_unavailable", message: "Live controls are unavailable" });
        }
        throw error;
      }
    }
  );

  app.get("/v1/admin/media/assets", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.providers.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listMediaAssets(adminListInput(query)));
  });

  app.get("/v1/admin/age-kyc/age-checks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.users.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAgeChecks(adminListInput(query)));
  });

  app.get("/v1/admin/age-kyc/identity-checks", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.users.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listIdentityChecks(adminListInput(query)));
  });

  app.get("/v1/admin/ai/sessions", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.ai.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAiSessions(adminListInput(query)));
  });

  app.get("/v1/admin/ai/tool-calls", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.ai.read");
    if (!allowed) return reply;

    const query = request.query as { cursor?: string };
    return reply.code(200).send(await options.adminRepository.listAiToolCalls(adminListInput(query)));
  });

  app.get("/v1/admin/mutuals/safety", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options, "admin.reports.read");
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getMutualsSafety());
  });
}

function validateLiveSuspension(
  body: Partial<AdminLiveRoomSuspensionRequest> | undefined
): string | null {
  if (!body || typeof body.suspended !== "boolean") return "suspended is required";
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) return "reason is required";
  if (body.reason.length > 1000) return "reason must be 1000 characters or fewer";
  return null;
}
