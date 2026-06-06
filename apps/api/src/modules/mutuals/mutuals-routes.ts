import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import {
  MutualsIdempotencyConflictError,
  MutualsRepositoryConfigurationError
} from "./mutuals-repository.js";
import type {
  ActivateMutualsRequest,
  MutualsRepository,
  MutualsInterestRequest,
  UpdateMutualsPreferencesRequest
} from "./types.js";

interface RegisterMutualsRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  mutualsRepository: MutualsRepository;
}

const defaultLimit = 20;

export async function registerMutualsRoutes(
  app: FastifyInstance,
  options: RegisterMutualsRoutesOptions
): Promise<void> {
  const activate = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<ActivateMutualsRequest> | undefined;

    if (!body?.consentVersion || body.consentVersion.trim().length < 3) {
      return reply.code(400).send(validationResponse("consentVersion is required"));
    }

    try {
      await options.sessionRepository.ensureUserForSupabaseId(access.supabaseUserId);
      const profile = await options.mutualsRepository.activate({
        supabaseUserId: access.supabaseUserId,
        consentVersion: body.consentVersion.trim()
      });

      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof MutualsRepositoryConfigurationError) {
        request.log.warn({ error }, "Mutuals activation failed");
        return reply.code(503).send(serviceUnavailableResponse("Mutuals mode is not configured"));
      }

      throw error;
    }
  };

  const updatePreferences = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<UpdateMutualsPreferencesRequest> | undefined;
    const validationError = validatePreferences(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const profile = await options.mutualsRepository.updatePreferences({
        supabaseUserId: access.supabaseUserId,
        body: body as UpdateMutualsPreferencesRequest
      });

      if (!profile) {
        return reply.code(404).send(notFoundResponse("Mutuals profile was not found"));
      }

      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof MutualsRepositoryConfigurationError) {
        request.log.warn({ error }, "Mutuals preference update failed");
        return reply.code(503).send(serviceUnavailableResponse("Mutuals mode is not configured"));
      }

      throw error;
    }
  };

  const listFeed = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    try {
      const query = request.query as { cursor?: string };
      const page = await options.mutualsRepository.listFeed({
        supabaseUserId: access.supabaseUserId,
        limit: defaultLimit,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      if (!page) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Mutuals mode must be active before viewing the Mutuals feed"
        });
      }

      return reply.code(200).send(page);
    } catch (error) {
      if (error instanceof MutualsRepositoryConfigurationError) {
        request.log.warn({ error }, "Mutuals feed failed");
        return reply.code(503).send(serviceUnavailableResponse("Mutuals mode is not configured"));
      }

      throw error;
    }
  };

  const createInterest = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = requiredIdempotencyKey(request);

    if (!idempotencyKey) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<MutualsInterestRequest> | undefined;
    const validationError = validateInterest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const interestBody = body as MutualsInterestRequest;
      const result = await options.mutualsRepository.createInterest({
        supabaseUserId: access.supabaseUserId,
        idempotencyKey,
        requestHash: hashJson(interestBody),
        body: interestBody
      });

      if (!result) {
        return reply.code(404).send(notFoundResponse("Mutuals target was not found"));
      }

      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof MutualsIdempotencyConflictError) {
        return reply.code(409).send(conflictResponse("Idempotency key was already used"));
      }

      if (error instanceof MutualsRepositoryConfigurationError) {
        request.log.warn({ error }, "Mutuals interest failed");
        return reply.code(503).send(serviceUnavailableResponse("Mutuals mode is not configured"));
      }

      throw error;
    }
  };

  const listMutuals = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };
    const page = await options.mutualsRepository.listMutuals({
      supabaseUserId: access.supabaseUserId,
      limit: defaultLimit,
      ...(query.cursor ? { cursor: query.cursor } : {})
    });

    return reply.code(200).send(page);
  };

  const archiveMutual = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyMutualsAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const mutual = await options.mutualsRepository.archiveMutual({
      supabaseUserId: access.supabaseUserId,
      matchId
    });

    if (!mutual) {
      return reply.code(404).send(notFoundResponse("Mutual was not found"));
    }

    return reply.code(200).send(mutual);
  };

  for (const routePath of ["/v1/mutuals/activate", "/v1/dating/activate"]) {
    app.post(routePath, activate);
  }

  for (const routePath of ["/v1/mutuals/preferences", "/v1/dating/preferences"]) {
    app.patch(routePath, updatePreferences);
  }

  for (const routePath of ["/v1/mutuals/feed", "/v1/dating/feed"]) {
    app.get(routePath, listFeed);
  }

  for (const routePath of ["/v1/mutuals/interests", "/v1/dating/swipes"]) {
    app.post(routePath, createInterest);
  }

  for (const routePath of ["/v1/mutuals", "/v1/dating/matches"]) {
    app.get(routePath, listMutuals);
  }

  for (const routePath of ["/v1/mutuals/:matchId/archive", "/v1/dating/matches/:matchId/archive"]) {
    app.patch(routePath, archiveMutual);
  }
}

type MutualsAccessResult =
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

async function verifyMutualsAccess(
  request: FastifyRequest,
  options: RegisterMutualsRoutesOptions
): Promise<MutualsAccessResult> {
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
        message: "Mutuals mode requires profile and age verification"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function validatePreferences(body: Partial<UpdateMutualsPreferencesRequest> | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.activeMatchLimit !== undefined &&
    (!Number.isSafeInteger(body.activeMatchLimit) || body.activeMatchLimit < 1 || body.activeMatchLimit > 50)
  ) {
    return "activeMatchLimit must be between 1 and 50";
  }

  return null;
}

function validateInterest(body: Partial<MutualsInterestRequest> | undefined): string | null {
  if (!body?.targetUserId) {
    return "targetUserId is required";
  }

  if (!body.contentId) {
    return "contentId is required";
  }

  if (body.action !== "yes" && body.action !== "not_interested") {
    return "action must be yes or not_interested";
  }

  return null;
}

function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : null;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

function conflictResponse(message: string) {
  return {
    code: "conflict",
    message
  };
}

function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}

function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}
