import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { listAccessPasses } from "./activity-access-pass-repository.js";
import { ActivityRepositoryConfigurationError } from "./activity-errors.js";
import { listActivity, listPaymentActivity } from "./activity-ledger-repository.js";
import { listWalletTransactions } from "./activity-wallet-repository.js";
import type { ActivityRepository } from "./types.js";

export { ActivityRepositoryConfigurationError } from "./activity-errors.js";

export function createPostgresActivityRepository(database?: string | PostgresSql): ActivityRepository {
  if (!database) {
    return {
      async listActivity() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listPaymentActivity() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listWalletTransactions() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listAccessPasses() {
        throw new ActivityRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async listActivity(input) {
      return listActivity(sql, input);
    },
    async listPaymentActivity(input) {
      return listPaymentActivity(sql, input);
    },
    async listWalletTransactions(input) {
      return listWalletTransactions(sql, input);
    },
    async listAccessPasses(input) {
      return listAccessPasses(sql, input);
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
