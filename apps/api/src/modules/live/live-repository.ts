import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { createLiveChatRepositoryMethods } from "./live-chat-repository.js";
import { createLiveControlRepositoryMethods } from "./live-control-repository.js";
import { LiveRepositoryConfigurationError } from "./live-errors.js";
import { createLiveRoomRepositoryMethods } from "./live-room-repository.js";
import { createLiveStatusRepositoryMethods } from "./live-status-repository.js";
import type { LiveRepository } from "./types.js";

export {
  LiveChatIdempotencyConflictError,
  LiveControlIdempotencyConflictError,
  LiveRepositoryConfigurationError,
  LiveRoomIdempotencyConflictError
} from "./live-errors.js";

export function createPostgresLiveRepository(database?: string | PostgresSql): LiveRepository {
  if (!database) {
    return createUnavailableLiveRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);
  const roomMethods = createLiveRoomRepositoryMethods(sql);

  return {
    ...roomMethods,
    ...createLiveControlRepositoryMethods(sql),
    ...createLiveStatusRepositoryMethods(sql),
    ...createLiveChatRepositoryMethods(sql, roomMethods.findRoom),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

function createUnavailableLiveRepository(): LiveRepository {
  return {
    async createRoom() {
      throw new LiveRepositoryConfigurationError();
    },
    async reserveRoom() {
      throw new LiveRepositoryConfigurationError();
    },
    async attachProviderRoom() {
      throw new LiveRepositoryConfigurationError();
    },
    async claimProviderCreation() {
      throw new LiveRepositoryConfigurationError();
    },
    async findRoom() {
      throw new LiveRepositoryConfigurationError();
    },
    async findOwnedRoom() {
      throw new LiveRepositoryConfigurationError();
    },
    async findOwnedRoomByIdempotency() {
      throw new LiveRepositoryConfigurationError();
    },
    async listOwnedRooms() {
      throw new LiveRepositoryConfigurationError();
    },
    async revealHostConnection() {
      throw new LiveRepositoryConfigurationError();
    },
    async reserveOwnedControl() {
      throw new LiveRepositoryConfigurationError();
    },
    async reserveStaffControl() {
      throw new LiveRepositoryConfigurationError();
    },
    async completeControl() {
      throw new LiveRepositoryConfigurationError();
    },
    async failControl() {
      throw new LiveRepositoryConfigurationError();
    },
    async recordLivePassPurchaseRequest() {
      throw new LiveRepositoryConfigurationError();
    },
    async recordLiveProviderWebhook() {
      throw new LiveRepositoryConfigurationError();
    },
    async updateRoomStatus() {
      throw new LiveRepositoryConfigurationError();
    },
    async updateRoomFromWebhook() {
      throw new LiveRepositoryConfigurationError();
    },
    async listChatMessages() {
      throw new LiveRepositoryConfigurationError();
    },
    async createChatMessage() {
      throw new LiveRepositoryConfigurationError();
    }
  };
}
