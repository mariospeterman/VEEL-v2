import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { MessageRepositoryConfigurationError } from "./message-errors.js";
import { listConversations, listMessages } from "./message-read-repository.js";
import {
  createMessage,
  findConversationPrice,
  recordPaidMessageDraft
} from "./message-write-repository.js";
import type { MessageRepository } from "./types.js";

export { MessageRepositoryConfigurationError } from "./message-errors.js";

export function createPostgresMessageRepository(database?: string | PostgresSql): MessageRepository {
  if (!database) {
    return {
      async listConversations() {
        throw new MessageRepositoryConfigurationError();
      },
      async listMessages() {
        throw new MessageRepositoryConfigurationError();
      },
      async createMessage() {
        throw new MessageRepositoryConfigurationError();
      },
      async findConversationPrice() {
        throw new MessageRepositoryConfigurationError();
      },
      async recordPaidMessageDraft() {
        throw new MessageRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async listConversations(input) {
      return listConversations(sql, input);
    },
    async listMessages(input) {
      return listMessages(sql, input);
    },
    async createMessage(input) {
      return createMessage(sql, input);
    },
    async findConversationPrice(input) {
      return findConversationPrice(sql, input);
    },
    async recordPaidMessageDraft(input) {
      await recordPaidMessageDraft(sql, input);
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
