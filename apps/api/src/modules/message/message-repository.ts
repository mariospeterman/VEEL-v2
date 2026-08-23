import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { MessageRepositoryConfigurationError } from "./message-errors.js";
import { listConversations, listMessages } from "./message-read-repository.js";
import {
  bindCreatorMediaOfferPaymentIntent,
  bindStructuredCreatorRequestPaymentIntent,
  createCreatorMediaOffer,
  createStructuredCreatorRequest,
  findCreatorMediaOfferPaymentAuthority,
  findStructuredCreatorRequestPaymentAuthority,
  listCommercialInteractions,
  updateCreatorMediaOffer,
  updateStructuredCreatorRequest
} from "./message-commercial-repository.js";
import {
  createDirectConversation,
  createMessage,
  findConversationPrice,
  markConversationRead,
  recordPaidMessageDraft,
  respondToMessageRequest,
  updateConversationMute,
  updateMessageReaction
} from "./message-write-repository.js";
import type { MessageRepository } from "./types.js";

export {
  MessageBlockedError,
  MessageIdempotencyConflictError,
  MessageRequestForbiddenError,
  MessageRequestLimitError,
  MessageRepositoryConfigurationError
} from "./message-errors.js";

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
      async createDirectConversation() {
        throw new MessageRepositoryConfigurationError();
      },
      async respondToMessageRequest() {
        throw new MessageRepositoryConfigurationError();
      },
      async markConversationRead() {
        throw new MessageRepositoryConfigurationError();
      },
      async updateConversationMute() {
        throw new MessageRepositoryConfigurationError();
      },
      async updateMessageReaction() {
        throw new MessageRepositoryConfigurationError();
      },
      async listCommercialInteractions() { throw new MessageRepositoryConfigurationError(); },
      async createCreatorMediaOffer() { throw new MessageRepositoryConfigurationError(); },
      async updateCreatorMediaOffer() { throw new MessageRepositoryConfigurationError(); },
      async findCreatorMediaOfferPaymentAuthority() { throw new MessageRepositoryConfigurationError(); },
      async bindCreatorMediaOfferPaymentIntent() { throw new MessageRepositoryConfigurationError(); },
      async createStructuredCreatorRequest() { throw new MessageRepositoryConfigurationError(); },
      async updateStructuredCreatorRequest() { throw new MessageRepositoryConfigurationError(); },
      async findStructuredCreatorRequestPaymentAuthority() { throw new MessageRepositoryConfigurationError(); },
      async bindStructuredCreatorRequestPaymentIntent() { throw new MessageRepositoryConfigurationError(); },
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
    async createDirectConversation(input) {
      return createDirectConversation(sql, input);
    },
    async respondToMessageRequest(input) {
      return respondToMessageRequest(sql, input);
    },
    async markConversationRead(input) {
      return markConversationRead(sql, input);
    },
    async updateConversationMute(input) {
      return updateConversationMute(sql, input);
    },
    async updateMessageReaction(input) {
      return updateMessageReaction(sql, input);
    },
    async listCommercialInteractions(input) { return listCommercialInteractions(sql, input); },
    async createCreatorMediaOffer(input) { return createCreatorMediaOffer(sql, input); },
    async updateCreatorMediaOffer(input) { return updateCreatorMediaOffer(sql, input); },
    async findCreatorMediaOfferPaymentAuthority(input) { return findCreatorMediaOfferPaymentAuthority(sql, input); },
    async bindCreatorMediaOfferPaymentIntent(input) { return bindCreatorMediaOfferPaymentIntent(sql, input); },
    async createStructuredCreatorRequest(input) { return createStructuredCreatorRequest(sql, input); },
    async updateStructuredCreatorRequest(input) { return updateStructuredCreatorRequest(sql, input); },
    async findStructuredCreatorRequestPaymentAuthority(input) { return findStructuredCreatorRequestPaymentAuthority(sql, input); },
    async bindStructuredCreatorRequestPaymentIntent(input) { return bindStructuredCreatorRequestPaymentIntent(sql, input); },
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
