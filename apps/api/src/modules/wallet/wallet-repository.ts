import postgres from "postgres";
import type { WalletRepository } from "./types.js";
import { createWalletCoreRepositoryMethods } from "./wallet-core-repository.js";
import { WalletRepositoryConfigurationError } from "./wallet-errors.js";
import { createWalletLinkRepositoryMethods } from "./wallet-link-repository.js";
import { createWalletOnrampRepositoryMethods } from "./wallet-onramp-repository.js";

export {
  WalletLinkChallengeNotFoundError,
  WalletLinkConflictError,
  WalletNotFoundError,
  WalletRepositoryConfigurationError
} from "./wallet-errors.js";

export function createPostgresWalletRepository(databaseUrl?: string): WalletRepository {
  if (!databaseUrl) {
    return {
      async listWalletsBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      },
      async hasWalletBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      },
      async createLinkChallenge() {
        throw new WalletRepositoryConfigurationError();
      },
      async consumeVerifiedExternalWalletLink() {
        throw new WalletRepositoryConfigurationError();
      },
      async findLinkChallenge() {
        throw new WalletRepositoryConfigurationError();
      },
      async findWalletForSupabaseUser() {
        throw new WalletRepositoryConfigurationError();
      },
      async setPrimaryWallet() {
        throw new WalletRepositoryConfigurationError();
      },
      async findOnrampSessionByIdempotencyKey() {
        throw new WalletRepositoryConfigurationError();
      },
      async recordOnrampSession() {
        throw new WalletRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    ...createWalletCoreRepositoryMethods(sql),
    ...createWalletLinkRepositoryMethods(sql),
    ...createWalletOnrampRepositoryMethods(sql),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
