import postgres from "postgres";
import type { EventRepository } from "./types.js";
import { EventRepositoryConfigurationError } from "./event-errors.js";
import { createEventAccessPassRepositoryMethods } from "./event-access-pass-methods.js";
import { createEventCoreRepositoryMethods } from "./event-core-repository.js";

export {
  EventIdempotencyConflictError,
  EventRepositoryConfigurationError
} from "./event-errors.js";

export function createPostgresEventRepository(databaseUrl?: string): EventRepository {
  if (!databaseUrl) {
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
      async findTicketOffer() {
        throw new EventRepositoryConfigurationError();
      },
      async recordTicketPurchaseRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async grantFreeTicket() {
        throw new EventRepositoryConfigurationError();
      },
      async createTicketRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async checkInTicket() {
        throw new EventRepositoryConfigurationError();
      },
      async listTickets() {
        throw new EventRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  const coreMethods = createEventCoreRepositoryMethods(sql);

  return {
    ...coreMethods,
    ...createEventAccessPassRepositoryMethods(sql, coreMethods.findEvent),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
