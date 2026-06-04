import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import {
  ReferralIdempotencyConflictError,
  ReferralRepositoryConfigurationError
} from "./referral-repository.js";
import type { CreateReferralTokenRequest, ReferralRepository } from "./types.js";

interface RegisterReferralRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  referralRepository: ReferralRepository;
}

const targetTypes = new Set(["content", "profile", "event"]);
const channels = new Set(["external", "partner", "internal"]);

export async function registerReferralRoutes(
  app: FastifyInstance,
  options: RegisterReferralRoutesOptions
): Promise<void> {
  app.post("/v1/referrals/tokens", async (request, reply) => {
    const access = await verifyReferralReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateReferralTokenRequest> | undefined;
    const validationError = validateCreateReferralTokenRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const token = createReferralToken();
    const tokenUrl = new URL("/r", app.config.WEB_URL);
    tokenUrl.searchParams.set("ref", token);

    try {
      const referral = await options.referralRepository.createOrReuseToken({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashReferralTokenRequest(body as CreateReferralTokenRequest),
        token,
        targetType: body?.targetType as "content" | "profile" | "event",
        targetId: body?.targetId ?? "",
        channel: body?.channel as "external" | "partner" | "internal",
        url: tokenUrl.toString()
      });

      return reply.code(201).send(referral);
    } catch (error) {
      if (error instanceof ReferralIdempotencyConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Idempotency key was already used for a different referral token"
        });
      }

      if (error instanceof ReferralRepositoryConfigurationError) {
        request.log.warn({ error }, "Referral repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Referrals are not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/referrals/activity", async (request, reply) => {
    const access = await verifyReferralReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      const activity = await options.referralRepository.listActivity({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(activity);
    } catch (error) {
      if (error instanceof ReferralRepositoryConfigurationError) {
        request.log.warn({ error }, "Referral repository is not configured");
        return reply.code(200).send({
          items: [],
          nextCursor: null
        });
      }

      throw error;
    }
  });
}

type ReferralReadyAccessResult =
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

async function verifyReferralReadyAccess(
  request: FastifyRequest,
  options: RegisterReferralRoutesOptions
): Promise<ReferralReadyAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const profile = await options.sessionRepository.findProfileBySupabaseUserId(
    verifiedSession.supabaseUserId
  );
  const [ageStatus, hasWallet] = await Promise.all([
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Referrals require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function validateCreateReferralTokenRequest(
  body: Partial<CreateReferralTokenRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.targetType !== "string" || !targetTypes.has(body.targetType)) {
    return "Unsupported targetType";
  }

  if (typeof body.targetId !== "string" || body.targetId.length === 0) {
    return "targetId is required";
  }

  if (typeof body.channel !== "string" || !channels.has(body.channel)) {
    return "Unsupported channel";
  }

  return null;
}

function hashReferralTokenRequest(body: CreateReferralTokenRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        targetType: body.targetType,
        targetId: body.targetId,
        channel: body.channel
      })
    )
    .digest("hex");
}

function createReferralToken(): string {
  return `veel_${randomBytes(18).toString("base64url")}`;
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
