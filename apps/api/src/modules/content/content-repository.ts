import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { createContentDraftRepositoryMethods } from "./content-draft-repository.js";
import { ContentRepositoryConfigurationError } from "./content-errors.js";
import { createContentFeedRepositoryMethods } from "./content-feed-repository.js";
import { createContentMediaRepositoryMethods } from "./content-media-repository.js";
import { createContentPublishRepositoryMethods } from "./content-publish-repository.js";
import { createContentQuotaRepositoryMethods } from "./content-quota-repository.js";
import { createContentReadRepositoryMethods } from "./content-read-repository.js";
import { createContentUpdateRepositoryMethods } from "./content-update-repository.js";
import { createContentWorkflowRepositoryMethods } from "./content-workflow-repository.js";
import type { ContentRepository } from "./types.js";

type PostgresContentRepository = ContentRepository & Required<Pick<
  ContentRepository,
  | "captureProviderObservationCutoff"
  | "findMediaAssetByProviderAsset"
  | "updateMediaAssetFromWebhook"
  | "updateMediaAssetPlayback"
>>;

export {
  ContentDraftIdempotencyConflictError,
  ContentDraftQuotaExceededError,
  ContentEventDraftConflictError,
  ContentPublishConflictError,
  ContentModerationAppealConflictError,
  ContentRepositoryConfigurationError
} from "./content-errors.js";

export function createPostgresContentRepository(
  database?: string | PostgresSql
): PostgresContentRepository {
  if (!database) {
    return createUnavailableContentRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    ...createContentDraftRepositoryMethods(sql),
    ...createContentFeedRepositoryMethods(sql),
    ...createContentMediaRepositoryMethods(sql),
    ...createContentPublishRepositoryMethods(sql),
    ...createContentQuotaRepositoryMethods(sql),
    ...createContentReadRepositoryMethods(sql),
    ...createContentUpdateRepositoryMethods(sql),
    ...createContentWorkflowRepositoryMethods(sql),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

function createUnavailableContentRepository(): PostgresContentRepository {
  return {
    async captureProviderObservationCutoff() {
      throw new ContentRepositoryConfigurationError();
    },
    async createDraft() {
      throw new ContentRepositoryConfigurationError();
    },
    async createMediaAsset() {
      throw new ContentRepositoryConfigurationError();
    },
    async countContentDraftsCreatedSince() {
      throw new ContentRepositoryConfigurationError();
    },
    async countMediaAssetsCreatedSince() {
      throw new ContentRepositoryConfigurationError();
    },
    async getContentCreationAbusePolicy() {
      throw new ContentRepositoryConfigurationError();
    },
    async findContentDetail() {
      throw new ContentRepositoryConfigurationError();
    },
    async findContentUnlockOffer() {
      throw new ContentRepositoryConfigurationError();
    },
    async findOwnedMediaAssetForSync() {
      throw new ContentRepositoryConfigurationError();
    },
    async findOwnedContentForUpload() {
      throw new ContentRepositoryConfigurationError();
    },
    async findMediaAssetByProviderAsset() {
      throw new ContentRepositoryConfigurationError();
    },
    async findOwnedContentForUpdate() {
      throw new ContentRepositoryConfigurationError();
    },
    async listHomeFeed() {
      throw new ContentRepositoryConfigurationError();
    },
    async listOwnedContent() {
      throw new ContentRepositoryConfigurationError();
    },
    async createModerationAppeal() {
      throw new ContentRepositoryConfigurationError();
    },
    async recordMediaProviderWebhook() {
      throw new ContentRepositoryConfigurationError();
    },
    async updateMediaAssetFromWebhook() {
      throw new ContentRepositoryConfigurationError();
    },
    async updateMediaAssetPlayback() {
      throw new ContentRepositoryConfigurationError();
    },
    async updateOwnedContent() {
      throw new ContentRepositoryConfigurationError();
    },
    async publishOwnedContent() {
      throw new ContentRepositoryConfigurationError();
    }
  };
}
