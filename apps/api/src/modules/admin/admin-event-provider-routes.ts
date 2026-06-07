import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { toAccessPass } from "./admin-route-adapters.js";
import { adminListInput, requireAdminAccess, type RegisterAdminRoutesOptions } from "./admin-route-auth.js";

export function registerAdminEventProviderRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
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

  app.get("/v1/admin/mutuals/safety", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;

    return reply.code(200).send(await options.adminRepository.getMutualsSafety());
  });
}
