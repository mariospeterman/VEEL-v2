import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { withSignedPlayback } from "../content/content-route-shared.js";
import type { MediaUploadProviderAdapter } from "../content/types.js";
import { withSignedLivePlayback } from "../live/live-route-shared.js";
import type { LiveProviderAdapter } from "../live/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { SubscriptionRepository } from "../subscription/types.js";
import type { WalletRepository } from "../wallet/types.js";
import { InvalidDiscoverCursorError } from "./discover-cursor.js";
import { DiscoverRepositoryConfigurationError } from "./discover-repository.js";
import type {
  DiscoverCursorSet,
  DiscoverLiveRoomPage,
  DiscoverRepository,
  DiscoverRepositoryPage
} from "./types.js";

interface RegisterDiscoverRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  discoverRepository: DiscoverRepository;
  mediaUploadProvider: MediaUploadProviderAdapter;
  liveProvider: LiveProviderAdapter;
  subscriptionRepository: SubscriptionRepository;
}

const defaultLimit = 12;

export async function registerDiscoverRoutes(
  app: FastifyInstance,
  options: RegisterDiscoverRoutesOptions
): Promise<void> {
  app.get("/v1/discover/search", async (request, reply) => {
    const access = await verifyDiscoverAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const query = request.query as {
      q?: string;
      cursor?: string;
      contentCursor?: string;
      creatorCursor?: string;
      hashtagCursor?: string;
      eventCursor?: string;
      liveCursor?: string;
    };

    if (query.cursor !== undefined) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Search requires a cursor for each result group"
      });
    }

    const cursors = discoverSearchCursors(query);
    if (!cursors.ok) {
      return reply.code(400).send({ code: "validation_failed", message: "Invalid discover cursor" });
    }

    try {
      const searchInput = {
        supabaseUserId: access.supabaseUserId,
        query: query.q,
        limit: defaultLimit
      };
      const page = await options.discoverRepository.search(
        Object.keys(cursors.value).length > 0
          ? { ...searchInput, cursors: cursors.value }
          : searchInput
      );

      return reply.code(200).send(await authorizeDiscoverPage(page, access, options));
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
    const query = request.query as { cursor?: string; contentCursor?: string };
    if (query.cursor !== undefined) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Hashtag results require a content cursor"
      });
    }
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
        cursor: query.contentCursor,
        limit: defaultLimit
      });

      return reply.code(200).send(await authorizeDiscoverPage(page, access, options));
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

      return reply.code(200).send(await authorizeLivePage(page, access, options));
    } catch (error) {
      return handleDiscoverError(reply, request, error);
    }
  });
}

type DiscoverAccessResult =
  | { ok: true; supabaseUserId: string; appUserId: string }
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
    supabaseUserId: verifiedSession.supabaseUserId,
    appUserId: profile.id
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
  if (error instanceof InvalidDiscoverCursorError) {
    return reply.code(400).send({
      code: "validation_failed",
      message: "Invalid discover cursor"
    });
  }

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
    nextCursors: {
      content: null,
      creators: null,
      hashtags: null,
      events: null,
      liveRooms: null
    }
  };
}

function discoverSearchCursors(query: {
  contentCursor?: unknown;
  creatorCursor?: unknown;
  hashtagCursor?: unknown;
  eventCursor?: unknown;
  liveCursor?: unknown;
}): { ok: true; value: Partial<Record<keyof DiscoverCursorSet, string>> } | { ok: false } {
  const mappings = [
    ["content", query.contentCursor],
    ["creators", query.creatorCursor],
    ["hashtags", query.hashtagCursor],
    ["events", query.eventCursor],
    ["liveRooms", query.liveCursor]
  ] as const;
  const value: Partial<Record<keyof DiscoverCursorSet, string>> = {};

  for (const [group, cursor] of mappings) {
    if (cursor === undefined) continue;
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512) {
      return { ok: false };
    }
    value[group] = cursor;
  }

  return { ok: true, value };
}

async function authorizeDiscoverPage(
  page: DiscoverRepositoryPage,
  access: Extract<DiscoverAccessResult, { ok: true }>,
  options: RegisterDiscoverRoutesOptions
) {
  const [content, liveRooms] = await Promise.all([
    Promise.all(page.content.map((item) => withSignedPlayback({
      content: item,
      mediaUploadProvider: options.mediaUploadProvider,
      subscriptionRepository: options.subscriptionRepository,
      supabaseUserId: access.supabaseUserId,
      appUserId: access.appUserId
    }))),
    Promise.all(page.liveRooms.map((room) => withSignedLivePlayback({
      room,
      supabaseUserId: access.supabaseUserId,
      appUserId: access.appUserId,
      liveProvider: options.liveProvider,
      subscriptionRepository: options.subscriptionRepository
    })))
  ]);

  return { ...page, content, liveRooms };
}

async function authorizeLivePage(
  page: DiscoverLiveRoomPage,
  access: Extract<DiscoverAccessResult, { ok: true }>,
  options: RegisterDiscoverRoutesOptions
) {
  return {
    ...page,
    items: await Promise.all(page.items.map((room) => withSignedLivePlayback({
      room,
      supabaseUserId: access.supabaseUserId,
      appUserId: access.appUserId,
      liveProvider: options.liveProvider,
      subscriptionRepository: options.subscriptionRepository
    })))
  };
}
