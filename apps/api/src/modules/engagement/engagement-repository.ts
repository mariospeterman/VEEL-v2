import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { EngagementRepository } from "./types.js";
import { EngagementRepositoryConfigurationError } from "./engagement-errors.js";
import { createEngagementCommentRepositoryMethods } from "./engagement-comment-repository.js";
import { createEngagementContentActionRepositoryMethods } from "./engagement-content-actions-repository.js";
import { createEngagementIntakeRepositoryMethods } from "./engagement-intake-repository.js";
import { createEngagementPreferencesRepositoryMethods } from "./engagement-preferences-repository.js";

export {
  EngagementIdempotencyConflictError,
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";

export function createPostgresEngagementRepository(database?: string | PostgresSql): EngagementRepository {
  if (!database) {
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

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    ...createEngagementPreferencesRepositoryMethods(sql),
    ...createEngagementContentActionRepositoryMethods(sql),
    ...createEngagementCommentRepositoryMethods(sql),
    ...createEngagementIntakeRepositoryMethods(sql),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
