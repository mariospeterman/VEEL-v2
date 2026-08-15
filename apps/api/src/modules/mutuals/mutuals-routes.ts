import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  conflictResponse,
  hashJson,
  notFoundResponse,
  requiredIdempotencyKey,
  serviceUnavailableResponse,
  type RegisterMutualsRoutesOptions,
  validationResponse,
  validateInterest,
  validatePreferences,
  verifyMutualsAccess
} from "./mutuals-route-utils.js";
import {
  MutualsIdempotencyConflictError,
  MutualsRepositoryConfigurationError
} from "./mutuals-repository.js";
import type {
  ActivateMutualsRequest,
  MutualsInterestRequest,
  UpdateMutualsPreferencesRequest
} from "./types.js";

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

    try {      const profile = await options.mutualsRepository.activate({
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

    const params = request.params as { mutualId?: string; matchId?: string };
    const mutualId = params.mutualId ?? params.matchId ?? "";
    const mutual = await options.mutualsRepository.archiveMutual({
      supabaseUserId: access.supabaseUserId,
      mutualId
    });

    if (!mutual) {
      return reply.code(404).send(notFoundResponse("Mutual was not found"));
    }

    return reply.code(200).send(mutual);
  };

  app.post("/v1/mutuals/activate", activate);
  app.patch("/v1/mutuals/preferences", updatePreferences);
  app.get("/v1/mutuals/feed", listFeed);
  app.post("/v1/mutuals/interests", createInterest);
  app.get("/v1/mutuals", listMutuals);
  app.patch("/v1/mutuals/:mutualId/archive", archiveMutual);
}
