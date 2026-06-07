import postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import { EngagementRepositoryConfigurationError } from "./engagement-errors.js";
import { createEngagementCommentRepositoryMethods } from "./engagement-comment-repository.js";
import { createEngagementContentActionRepositoryMethods } from "./engagement-content-actions-repository.js";
import { createEngagementIntakeRepositoryMethods } from "./engagement-intake-repository.js";
import { createEngagementPreferencesRepositoryMethods } from "./engagement-preferences-repository.js";

export {
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";

export function createPostgresEngagementRepository(databaseUrl?: string): EngagementRepository {
  if (!databaseUrl) {
    return {
      async getFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async updateFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async resetFeedRecommendations() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideCreator() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideTopic() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleLike() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleSave() {
        throw new EngagementRepositoryConfigurationError();
      },
      async listComments() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createComment() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createShare() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createReport() {
        throw new EngagementRepositoryConfigurationError();
      },
      async blockUser() {
        throw new EngagementRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    ...createEngagementPreferencesRepositoryMethods(sql),
    ...createEngagementContentActionRepositoryMethods(sql),
    ...createEngagementCommentRepositoryMethods(sql),
    ...createEngagementIntakeRepositoryMethods(sql),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
