import type { FastifyInstance } from "fastify";
import { unauthorizedResponse } from "../auth/http-auth.js";
import { ContentRepositoryConfigurationError } from "./content-repository.js";
import {
  MediaWebhookConfigurationError,
  MediaWebhookSignatureError,
  MediaWebhookValidationError,
  normalizeMediaWebhook,
  type MediaWebhookProvider
} from "./media-webhook-adapter.js";
import {
  rawBodyBuffer,
  type RegisterContentRoutesOptions
} from "./content-route-shared.js";

const mediaWebhookProviders = new Set<MediaWebhookProvider>(["bunny", "livepeer"]);

export async function registerContentWebhookRoutes(
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
}
