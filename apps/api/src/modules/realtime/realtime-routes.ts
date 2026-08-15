import type { FastifyInstance } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { requireIdempotencyKey } from "../../shared/idempotency.js";
import {
  verifyMessageReadyAccess,
  type RegisterMessageRoutesOptions
} from "../message/message-route-utils.js";
import { RealtimeTokenConfigurationError } from "./realtime-token.js";
import type { RealtimeTokenIssuer } from "./types.js";

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  options: Pick<
    RegisterMessageRoutesOptions,
    "authVerifier" | "sessionRepository" | "ageRepository" | "walletRepository"
  > & {
    realtimeTokenIssuer: RealtimeTokenIssuer;
  }
): Promise<void> {
  app.post("/v1/realtime/token", mutationRateLimit("sessionMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);

    try {
      return reply.code(201).send(
        await options.realtimeTokenIssuer.issueToken({ userId: access.userId })
      );
    } catch (error) {
      if (error instanceof RealtimeTokenConfigurationError) {
        request.log.warn("Realtime token signing is not configured");
        return reply.code(503).send({
          code: "provider_unavailable",
          message: "Realtime updates are not configured"
        });
      }

      throw error;
    }
  });
}
