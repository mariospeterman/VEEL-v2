import postgres from "postgres";
import { createLiveChatRepositoryMethods } from "./live-chat-repository.js";
import { LiveRepositoryConfigurationError } from "./live-errors.js";
import { createLiveRoomRepositoryMethods } from "./live-room-repository.js";
import { createLiveStatusRepositoryMethods } from "./live-status-repository.js";
import type { LiveRepository } from "./types.js";

export { LiveRepositoryConfigurationError, LiveRoomIdempotencyConflictError } from "./live-errors.js";

export function createPostgresLiveRepository(databaseUrl?: string): LiveRepository {
  if (!databaseUrl) {
    return createUnavailableLiveRepository();
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });
  const roomMethods = createLiveRoomRepositoryMethods(sql);

  return {
    ...roomMethods,
    ...createLiveStatusRepositoryMethods(sql),
    ...createLiveChatRepositoryMethods(sql, roomMethods.findRoom),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function createUnavailableLiveRepository(): LiveRepository {
  return {
    async createRoom() {
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
