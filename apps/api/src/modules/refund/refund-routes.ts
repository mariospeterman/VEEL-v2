import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import { RefundRepositoryConfigurationError } from "./refund-repository.js";
import type { CreateRefundDisputeRequest, RefundRepository } from "./types.js";

interface RegisterRefundRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  refundRepository: RefundRepository;
}

export async function registerRefundRoutes(
  app: FastifyInstance,
  options: RegisterRefundRoutesOptions
): Promise<void> {
  app.get("/v1/refunds/requests", async (request, reply) => {
    const access = await verifyRefundAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      return reply.code(200).send(
        await options.refundRepository.listRequests({
          supabaseUserId: access.supabaseUserId,
          ...(query.cursor ? { cursor: query.cursor } : {})
        })
      );
    } catch (error) {
      if (error instanceof RefundRepositoryConfigurationError) {
        request.log.warn({ error }, "Refund repository is not configured");
        return reply.code(200).send({ items: [], nextCursor: null });
      }

      throw error;
    }
  });

  app.post("/v1/refunds/requests", async (request, reply) => {
    const access = await verifyRefundAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateRefundDisputeRequest> | undefined;
    const validationError = validateCreateRefundDisputeRequest(body);
    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const requestRecord = await options.refundRepository.createRequest({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        body: body as CreateRefundDisputeRequest
      });

      if (!requestRecord) {
        return reply.code(404).send({
          code: "not_found",
          message: "Payment intent was not found"
        });
      }

      return reply.code(201).send(requestRecord);
    } catch (error) {
      if (error instanceof RefundRepositoryConfigurationError) {
        request.log.warn({ error }, "Refund repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Refund requests are not configured"
        });
      }

      throw error;
    }
  });
}

type RefundAccessResult =
  | {
      ok: true;
      supabaseUserId: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: {
        code: string;
        message: string;
      };
    };

async function verifyRefundAccess(
  request: FastifyRequest,
  options: RegisterRefundRoutesOptions
): Promise<RefundAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);
  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Refund requests require profile and age verification"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function validateCreateRefundDisputeRequest(
  body: Partial<CreateRefundDisputeRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.paymentIntentId !== "string" || body.paymentIntentId.length === 0) {
    return "paymentIntentId is required";
  }

  if (body.kind !== "refund_request" && body.kind !== "dispute" && body.kind !== "access_issue") {
    return "kind is invalid";
  }

  if (
    body.requestedAction !== "review_only" &&
    body.requestedAction !== "creator_refund" &&
    body.requestedAction !== "revoke_access" &&
    body.requestedAction !== "replacement_access"
  ) {
    return "requestedAction is invalid";
  }

  if (!body.reason || body.reason.trim().length < 10 || body.reason.length > 1000) {
    return "reason must be 10-1000 characters";
  }

  return null;
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
