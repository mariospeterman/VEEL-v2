import type { FastifyInstance } from "fastify";
import { hashIdempotencyPayload, readIdempotencyKey } from "../../shared/idempotency.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { ContentPollVoteConflictError, ContentRepositoryConfigurationError } from "./content-repository.js";
import { verifyAppReadyAccess, type RegisterContentRoutesOptions } from "./content-route-shared.js";
import type { VoteOnContentPollRequest } from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerContentPollRoutes(app: FastifyInstance, options: RegisterContentRoutesOptions): Promise<void> {
  app.post("/v1/content/:contentId/poll-votes", mutationRateLimit("socialMutation", "voteOnContentPoll"), async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const { contentId } = request.params as { contentId?: string };
    const body = request.body as Partial<VoteOnContentPollRequest> | undefined;
    const idempotencyKey = readIdempotencyKey(request);
    if (!contentId || !uuidPattern.test(contentId) || !body?.optionId || !uuidPattern.test(body.optionId) || !idempotencyKey) {
      return reply.code(400).send({ code: "validation_failed", message: "A valid contentId, optionId, and Idempotency-Key are required" });
    }

    try {
      if (!options.contentRepository.voteOnPoll) throw new ContentRepositoryConfigurationError();
      const poll = await options.contentRepository.voteOnPoll({
        appUserId: access.appUserId,
        contentId,
        optionId: body.optionId,
        idempotencyKey,
        requestHash: hashIdempotencyPayload({ contentId, optionId: body.optionId })
      });
      if (!poll) return reply.code(404).send({ code: "not_found", message: "Poll or option not found" });
      return reply.code(200).send(poll);
    } catch (error) {
      if (error instanceof ContentPollVoteConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: error.reason === "poll_closed" ? "Poll voting is closed" : "Idempotency key was already used for a different poll vote"
        });
      }
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Content storage is not configured" });
      }
      throw error;
    }
  });
}
