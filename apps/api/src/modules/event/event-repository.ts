import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { EventRepository } from "./types.js";
import { EventRepositoryConfigurationError } from "./event-errors.js";
import { createEventAccessPassRepositoryMethods } from "./event-access-pass-methods.js";
import { createEventCoreRepositoryMethods } from "./event-core-repository.js";

export {
  EventIdempotencyConflictError,
  EventRepositoryConfigurationError
} from "./event-errors.js";

export function createPostgresEventRepository(database?: string | PostgresSql): EventRepository {
  if (!database) {
    return {
      async createEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async findEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async updateEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async findAccessPassOffer() {
        throw new EventRepositoryConfigurationError();
      },
      async recordAccessPassPurchaseRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async grantFreeAccessPass() {
        throw new EventRepositoryConfigurationError();
      },
      async createAccessPassRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async checkInAccessPass() {
        throw new EventRepositoryConfigurationError();
      },
      async listAccessPasses() {
        throw new EventRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  const coreMethods = createEventCoreRepositoryMethods(sql);

  return {
    ...coreMethods,
    ...createEventAccessPassRepositoryMethods(sql, coreMethods.findEvent),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
