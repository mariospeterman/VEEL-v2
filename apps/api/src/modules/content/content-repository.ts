import postgres from "postgres";
import { createContentDraftRepositoryMethods } from "./content-draft-repository.js";
import { ContentRepositoryConfigurationError } from "./content-errors.js";
import { createContentFeedRepositoryMethods } from "./content-feed-repository.js";
import { createContentMediaRepositoryMethods } from "./content-media-repository.js";
import { createContentReadRepositoryMethods } from "./content-read-repository.js";
import type { ContentRepository } from "./types.js";

export { ContentRepositoryConfigurationError } from "./content-errors.js";

export function createPostgresContentRepository(databaseUrl?: string): ContentRepository {
  if (!databaseUrl) {
    return createUnavailableContentRepository();
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    ...createContentDraftRepositoryMethods(sql),
    ...createContentFeedRepositoryMethods(sql),
    ...createContentMediaRepositoryMethods(sql),
    ...createContentReadRepositoryMethods(sql),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function createUnavailableContentRepository(): ContentRepository {
  return {
    async createDraft() {
      throw new ContentRepositoryConfigurationError();
    },
    async createMediaAsset() {
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
    async listHomeFeed() {
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
    }
  };
}
