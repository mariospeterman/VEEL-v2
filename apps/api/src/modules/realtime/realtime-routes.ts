import type { FastifyInstance } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { readIdempotencyKey, requireIdempotencyKey } from "../../shared/idempotency.js";
import {
  verifyMessageReadyAccess,
  type RegisterMessageRoutesOptions
} from "../message/message-route-utils.js";
import { RealtimeTokenConfigurationError } from "./realtime-token.js";
import type { RealtimeTokenIssuer } from "./types.js";
import type { RealtimeConnectionEventRequest } from "./types.js";
import type { PostgresSql } from "../../shared/postgres.js";

const topicKinds = new Set(["account", "conversation", "live"]);
const connectionStates = new Set(["connected", "reconnecting", "failed", "disconnected"]);
const reasonCodes = new Set(["subscribed", "channel_error", "timed_out", "closed", "token_unavailable", "cleanup"]);

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  options: Pick<
    RegisterMessageRoutesOptions,
    "authVerifier" | "sessionRepository" | "ageRepository" | "walletRepository"
  > & {
    realtimeTokenIssuer: RealtimeTokenIssuer;
    postgresClient?: PostgresSql;
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

  app.post("/v1/realtime/telemetry", mutationRateLimit("sessionMutation"), async (request, reply) => {
    const access = await verifyMessageReadyAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);
    const idempotencyError = requireIdempotencyKey(request);
    if (idempotencyError) return reply.code(400).send(idempotencyError);
    const idempotencyKey = readIdempotencyKey(request) as string;
    const body = request.body as Partial<RealtimeConnectionEventRequest> | undefined;
    const occurredAt = typeof body?.occurredAt === "string" ? new Date(body.occurredAt) : null;
    if (
      !body ||
      !topicKinds.has(body.topicKind ?? "") ||
      !connectionStates.has(body.state ?? "") ||
      !reasonCodes.has(body.reasonCode ?? "") ||
      !Number.isInteger(body.attempt) ||
      (body.attempt ?? -1) < 0 ||
      (body.attempt ?? 11) > 10 ||
      !occurredAt ||
      Number.isNaN(occurredAt.getTime()) ||
      Math.abs(Date.now() - occurredAt.getTime()) > 24 * 60 * 60 * 1000
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "A bounded realtime connection event is required"
      });
    }
    if (!options.postgresClient) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Realtime telemetry is not configured"
      });
    }

    await options.postgresClient`
      insert into realtime_connection_events (
        user_id, topic_kind, state, reason_code, attempt, occurred_at, idempotency_key
      ) values (
        ${access.userId}, ${body.topicKind as string}, ${body.state as string},
        ${body.reasonCode as string}, ${body.attempt as number}, ${occurredAt}, ${idempotencyKey}
      )
      on conflict (user_id, idempotency_key) do nothing
    `;
    return reply.code(204).send();
  });
}
