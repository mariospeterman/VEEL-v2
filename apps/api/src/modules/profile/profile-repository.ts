import postgres from "postgres";
import { createProfileCreatorRepositoryMethods } from "./profile-creator-repository.js";
import { createProfileDashboardRepositoryMethods } from "./profile-dashboard-repository.js";
import { ProfileRepositoryConfigurationError } from "./profile-errors.js";
import { createProfileMutationRepositoryMethods } from "./profile-mutation-repository.js";
import type { ProfileRepository } from "./types.js";

export { ProfileHandleConflictError, ProfileRepositoryConfigurationError } from "./profile-errors.js";

export function createPostgresProfileRepository(databaseUrl?: string): ProfileRepository {
  if (!databaseUrl) {
    return createUnavailableProfileRepository();
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    ...createProfileMutationRepositoryMethods(sql),
    ...createProfileCreatorRepositoryMethods(sql),
    ...createProfileDashboardRepositoryMethods(sql),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function createUnavailableProfileRepository(): ProfileRepository {
  return {
    async upsertMyProfile() {
      throw new ProfileRepositoryConfigurationError();
    },
    async findCreatorProfileByHandle() {
      throw new ProfileRepositoryConfigurationError();
    },
    async getMyCreatorDashboard() {
      throw new ProfileRepositoryConfigurationError();
    },
    async getMyCreatorOnboarding() {
      throw new ProfileRepositoryConfigurationError();
    }
  };
}
