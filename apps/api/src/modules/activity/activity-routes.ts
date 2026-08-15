import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import { ActivityRepositoryConfigurationError } from "./activity-repository.js";
import { normalizeActivityPage } from "./activity-repository-mappers.js";
import type { ActivityRepository } from "./types.js";

interface RegisterActivityRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  activityRepository: ActivityRepository;
}

export async function registerActivityRoutes(
  app: FastifyInstance,
  options: RegisterActivityRoutesOptions
): Promise<void> {
  app.get("/v1/activity", async (request, reply) => {
    const access = await verifyActivityAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      const activity = await options.activityRepository.listActivity({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(normalizeActivityPage(activity));
    } catch (error) {
      if (error instanceof ActivityRepositoryConfigurationError) {
        request.log.warn({ error }, "Activity repository is not configured");
        return reply.code(200).send({ items: [], nextCursor: null });
      }

      throw error;
    }
  });

  app.get("/v1/activity/payments", async (request, reply) => {
    const access = await verifyActivityAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      const activity = await options.activityRepository.listPaymentActivity({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(normalizeActivityPage(activity));
    } catch (error) {
      if (error instanceof ActivityRepositoryConfigurationError) {
        request.log.warn({ error }, "Activity repository is not configured");
        return reply.code(200).send({ items: [], nextCursor: null });
      }

      throw error;
    }
  });

  app.get("/v1/activity/wallet-transactions", async (request, reply) => {
    const access = await verifyActivityAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      const transactions = await options.activityRepository.listWalletTransactions({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(transactions);
    } catch (error) {
      if (error instanceof ActivityRepositoryConfigurationError) {
        request.log.warn({ error }, "Activity repository is not configured");
        return reply.code(200).send({ items: [], nextCursor: null });
      }

      throw error;
    }
  });

  const listAccessPasses = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await verifyActivityAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { cursor?: string };

    try {
      const accessPasses = await options.activityRepository.listAccessPasses({
        supabaseUserId: access.supabaseUserId,
        limit: 20,
        ...(query.cursor ? { cursor: query.cursor } : {})
      });

      return reply.code(200).send(accessPasses);
    } catch (error) {
      if (error instanceof ActivityRepositoryConfigurationError) {
        request.log.warn({ error }, "Activity repository is not configured");
        return reply.code(200).send({ items: [], nextCursor: null });
      }

      throw error;
    }
  };

  app.get("/v1/activity/access-passes", listAccessPasses);
}

type ActivityAccessResult =
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

async function verifyActivityAccess(
  request: FastifyRequest,
  options: RegisterActivityRoutesOptions
): Promise<ActivityAccessResult> {
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

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Activity requires profile and age verification"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}
