import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import { DiscoverRepositoryConfigurationError } from "./discover-repository.js";
import type { DiscoverRepository } from "./types.js";

interface RegisterDiscoverRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  discoverRepository: DiscoverRepository;
}

const defaultLimit = 12;

export async function registerDiscoverRoutes(
  app: FastifyInstance,
  options: RegisterDiscoverRoutesOptions
): Promise<void> {
  app.get("/v1/discover/search", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { q?: string; cursor?: string };

    try {
      const page = await options.discoverRepository.search({
        supabaseUserId: access.supabaseUserId,
        query: query.q,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });

  app.get("/v1/discover/hashtags", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { q?: string; cursor?: string };

    try {
      const page = await options.discoverRepository.listHashtags({
        supabaseUserId: access.supabaseUserId,
        query: query.q,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });

  app.get("/v1/discover/hashtags/:slug", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const params = request.params as { slug?: string };
    const query = request.query as { cursor?: string };
    const slug = normalizeSlug(params.slug);

    if (!slug) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "slug is required"
      });
    }

    try {
      const page = await options.discoverRepository.getHashtag({
        supabaseUserId: access.supabaseUserId,
        slug,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });

  app.get("/v1/discover/creators", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { q?: string; cursor?: string };

    try {
      const page = await options.discoverRepository.listCreators({
        supabaseUserId: access.supabaseUserId,
        query: query.q,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });

  app.get("/v1/discover/events", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { q?: string; cursor?: string };

    try {
      const page = await options.discoverRepository.listEvents({
        supabaseUserId: access.supabaseUserId,
        query: query.q,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });

  app.get("/v1/discover/live", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as { cursor?: string };

    try {
      const page = await options.discoverRepository.listLive({
        supabaseUserId: access.supabaseUserId,
        cursor: query.cursor,
        limit: defaultLimit
      });

      return reply.code(200).send(page);
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });
}

type DiscoverAccessResult =
  | { ok: true; supabaseUserId: string }
  | { ok: false; statusCode: 401 | 403; body: { code: string; message: string } };

async function verifyDiscoverAccess(
  request: FastifyRequest,
  options: RegisterDiscoverRoutesOptions
): Promise<DiscoverAccessResult> {
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

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Discover requires profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function normalizeSlug(value: string | undefined): string | null {
  const slug = value?.trim().replace(/^#/, "").toLowerCase();

  return slug && /^[a-z0-9][a-z0-9_]{0,63}$/.test(slug) ? slug : null;
}

function handleDiscoverError(
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  request: FastifyRequest,
  error: unknown
) {
  if (error instanceof DiscoverRepositoryConfigurationError) {
    request.log.warn({ error }, "Discover repository is not configured");
    return reply.code(200).send(emptyDiscoverPage());
  }

  throw error;
}

function emptyDiscoverPage() {
  return {
    content: [],
    creators: [],
    hashtags: [],
    events: [],
    liveRooms: [],
    nextCursor: null
  };
}
