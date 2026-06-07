import postgres from "postgres";
import { listAccessPasses } from "./activity-access-pass-repository.js";
import { ActivityRepositoryConfigurationError } from "./activity-errors.js";
import { listActivity, listPaymentActivity } from "./activity-ledger-repository.js";
import { listWalletTransactions } from "./activity-wallet-repository.js";
import type { ActivityRepository } from "./types.js";

export { ActivityRepositoryConfigurationError } from "./activity-errors.js";

export function createPostgresActivityRepository(databaseUrl?: string): ActivityRepository {
  if (!databaseUrl) {
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

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

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
      await sql.end({ timeout: 5 });
    }
  };
}
