import type { FastifyInstance, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { LiveRepository } from "../live/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import { ContentRepositoryConfigurationError } from "./content-repository.js";
import {
  MediaUploadProviderConfigurationError,
  MediaUploadProviderError
} from "./media-upload-adapter.js";
import {
  MediaWebhookConfigurationError,
  MediaWebhookSignatureError,
  MediaWebhookValidationError,
  normalizeMediaWebhook,
  type MediaWebhookProvider
} from "./media-webhook-adapter.js";
import type {
  ContentRepository,
  CreateContentRequest,
  CreateUploadRequest,
  FeedMode,
  MediaUploadProviderAdapter
} from "./types.js";

interface RegisterContentRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
  mediaUploadProvider: MediaUploadProviderAdapter;
  liveRepository?: LiveRepository;
}

const feedModes = new Set(["recommended", "following", "nsfw", "sfw", "live", "premium"]);
const contentMediaTypes = new Set(["bit", "clip", "image", "vod", "live_replay"]);
const contentVisibilityValues = new Set(["public", "followers", "subscribers", "private"]);
const nsfwLabels = new Set(["none", "adult", "explicit", "sensitive"]);
const videoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const mediaWebhookProviders = new Set<MediaWebhookProvider>(["bunny", "livepeer"]);

export async function registerContentRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  app.post(
    "/v1/webhooks/media/:provider",
    {
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const params = request.params as { provider?: string };

      if (!params.provider || !mediaWebhookProviders.has(params.provider as MediaWebhookProvider)) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "Unsupported media provider"
        });
      }

      try {
        const normalized = normalizeMediaWebhook({
          provider: params.provider as MediaWebhookProvider,
          body: request.body,
          rawBody: rawBodyBuffer(request.rawBody),
          headers: request.headers,
          env: app.config
        });

        if (normalized.provider === "livepeer" && normalized.livepeerStream) {
          if (
            !options.liveRepository?.recordLiveProviderWebhook ||
            !options.liveRepository.updateRoomFromWebhook
          ) {
            return reply.code(503).send({
              code: "service_unavailable",
              message: "Livepeer webhook storage is not configured"
            });
          }

          const isNewLiveEvent = await options.liveRepository.recordLiveProviderWebhook({
            providerEventId: normalized.providerEventId,
            eventType: normalized.eventType,
            normalizedState: normalized.providerState,
            signatureHash: normalized.signatureHash
          });

          if (!isNewLiveEvent) {
            return reply.code(202).send({
              provider: normalized.provider,
              received: 1,
              processed: 0
            });
          }

          const appliedLiveEvent = await options.liveRepository.updateRoomFromWebhook({
            providerEventId: normalized.providerEventId,
            providerStreamId: normalized.livepeerStream.providerStreamId,
            providerPlaybackId: normalized.livepeerStream.providerPlaybackId,
            providerState: normalized.providerState,
            state: normalized.livepeerStream.roomState,
            playbackUrl: normalized.livepeerStream.playbackUrl
          });

          return reply.code(202).send({
            provider: normalized.provider,
            received: 1,
            processed: appliedLiveEvent ? 1 : 0
          });
        }

        if (
          !options.contentRepository.recordMediaProviderWebhook ||
          !options.contentRepository.updateMediaAssetFromWebhook
        ) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Media webhook storage is not configured"
          });
        }
        const isNewEvent = await options.contentRepository.recordMediaProviderWebhook({
          provider: normalized.provider,
          providerEventId: normalized.providerEventId,
          eventType: normalized.eventType,
          normalizedState: normalized.providerState,
          signatureHash: normalized.signatureHash
        });

        if (!isNewEvent) {
          return reply.code(202).send({
            provider: normalized.provider,
            received: 1,
            processed: 0
          });
        }

        const applied = await options.contentRepository.updateMediaAssetFromWebhook({
          provider: normalized.provider,
          providerEventId: normalized.providerEventId,
          providerAssetId: normalized.providerAssetId,
          providerState: normalized.providerState,
          providerPlayable: normalized.providerPlayable
        });

        return reply.code(202).send({
          provider: normalized.provider,
          received: 1,
          processed: applied ? 1 : 0
        });
      } catch (error) {
        if (error instanceof MediaWebhookSignatureError) {
          return reply.code(401).send(unauthorizedResponse("Missing or invalid webhook signature"));
        }

        if (error instanceof MediaWebhookValidationError) {
          return reply.code(400).send({
            code: "validation_failed",
            message: error.message
          });
        }

        if (
          error instanceof MediaWebhookConfigurationError ||
          error instanceof ContentRepositoryConfigurationError
        ) {
          request.log.warn({ error }, "Media webhook is not configured");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Media webhook is not configured"
          });
        }

        throw error;
      }
    }
  );

  app.post("/v1/content", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<CreateContentRequest> | undefined;

    if (
      !body ||
      typeof body.mediaType !== "string" ||
      !contentMediaTypes.has(body.mediaType) ||
      typeof body.visibility !== "string" ||
      !contentVisibilityValues.has(body.visibility) ||
      typeof body.nsfwLabel !== "string" ||
      !nsfwLabels.has(body.nsfwLabel)
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "mediaType, visibility, and nsfwLabel are required"
      });
    }

    try {
      const content = await options.contentRepository.createDraft({
        supabaseUserId: access.supabaseUserId,
        mediaType: body.mediaType,
        caption: typeof body.caption === "string" ? body.caption : null,
        visibility: body.visibility,
        nsfwLabel: body.nsfwLabel
      });

      return reply.code(201).send(content);
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.get("/v1/content/feed", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const query = request.query as { mode?: string; cursor?: string };
    const mode = feedModes.has(query.mode ?? "") ? (query.mode as FeedMode) : "recommended";

    try {
      const feedInput = {
        supabaseUserId: access.supabaseUserId,
        mode,
        limit: 20
      };

      const feed = await options.contentRepository.listHomeFeed(
        query.cursor ? { ...feedInput, cursor: query.cursor } : feedInput
      );

      return reply.code(200).send(feed);
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(200).send({
          items: [],
          nextCursor: null
        });
      }

      throw error;
    }
  });

  app.get("/v1/content/:contentId", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const params = request.params as { contentId?: string };

    if (typeof params.contentId !== "string" || params.contentId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId is required"
      });
    }

    try {
      const content = await options.contentRepository.findContentDetail({
        supabaseUserId: access.supabaseUserId,
        contentId: params.contentId
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content was not found"
        });
      }

      return reply.code(200).send(content);
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/media/uploads", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as Partial<CreateUploadRequest> | undefined;

    if (
      !body ||
      typeof body.contentId !== "string" ||
      typeof body.fileName !== "string" ||
      typeof body.mimeType !== "string" ||
      !videoMimeTypes.has(body.mimeType)
    ) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "contentId, fileName, and supported video mimeType are required"
      });
    }

    try {
      const content = await options.contentRepository.findOwnedContentForUpload({
        supabaseUserId: access.supabaseUserId,
        contentId: body.contentId
      });

      if (!content) {
        return reply.code(404).send({
          code: "not_found",
          message: "Content draft was not found"
        });
      }

      if (!options.mediaUploadProvider.isConfigured()) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media upload provider is not configured"
        });
      }

      const providerSession = await options.mediaUploadProvider.createUploadSession({
        contentId: content.id,
        title: content.caption || body.fileName,
        mimeType: body.mimeType
      });

      await options.contentRepository.createMediaAsset({
        contentId: content.id,
        provider: providerSession.provider,
        providerAssetId: providerSession.providerAssetId,
        providerState: "created"
      });

      return reply.code(201).send({
        uploadUrl: providerSession.uploadUrl,
        provider: providerSession.provider,
        headers: providerSession.headers,
        expiresAt: providerSession.expiresAt.toISOString()
      });
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      if (
        error instanceof MediaUploadProviderConfigurationError ||
        error instanceof MediaUploadProviderError
      ) {
        request.log.warn({ error }, "Media upload provider failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media upload provider is unavailable"
        });
      }

      throw error;
    }
  });

  app.post("/v1/media/assets/:mediaAssetId/sync", async (request, reply) => {
    const access = await verifyAppReadyAccess(request, options);

    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const params = request.params as { mediaAssetId?: string };

    if (typeof params.mediaAssetId !== "string" || params.mediaAssetId.length === 0) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "mediaAssetId is required"
      });
    }

    try {
      if (
        !options.contentRepository.findOwnedMediaAssetForSync ||
        !options.contentRepository.updateMediaAssetPlayback ||
        !options.mediaUploadProvider.getPlaybackData
      ) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider sync is not configured"
        });
      }

      const mediaAsset = await options.contentRepository.findOwnedMediaAssetForSync({
        supabaseUserId: access.supabaseUserId,
        mediaAssetId: params.mediaAssetId
      });

      if (!mediaAsset) {
        return reply.code(404).send({
          code: "not_found",
          message: "Media asset was not found"
        });
      }

      if (!options.mediaUploadProvider.isConfigured()) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider is not configured"
        });
      }

      const playbackData = await options.mediaUploadProvider.getPlaybackData({
        providerAssetId: mediaAsset.providerAssetId
      });

      await options.contentRepository.updateMediaAssetPlayback({
        mediaAssetId: mediaAsset.id,
        ...playbackData
      });

      return reply.code(202).send();
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Content storage is not configured"
        });
      }

      if (
        error instanceof MediaUploadProviderConfigurationError ||
        error instanceof MediaUploadProviderError
      ) {
        request.log.warn({ error }, "Media provider sync failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Media provider is unavailable"
        });
      }

      throw error;
    }
  });
}

function rawBodyBuffer(rawBody: unknown): Buffer {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }

  if (typeof rawBody === "string") {
    return Buffer.from(rawBody, "utf8");
  }

  return Buffer.alloc(0);
}

type AppReadyAccessResult =
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

async function verifyAppReadyAccess(
  request: FastifyRequest,
  options: RegisterContentRoutesOptions
): Promise<AppReadyAccessResult> {
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
        message: "Protected content access requires profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}
