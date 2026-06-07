import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
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

export function createPostgresWalletRepository(database?: string | PostgresSql): WalletRepository {
  if (!database) {
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

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    ...createWalletCoreRepositoryMethods(sql),
    ...createWalletLinkRepositoryMethods(sql),
    ...createWalletOnrampRepositoryMethods(sql),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
