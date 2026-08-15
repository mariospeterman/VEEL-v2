import type { components } from "@veel/contracts";

export type Conversation = components["schemas"]["Conversation"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type CreatePaidMessageIntentRequest = components["schemas"]["CreatePaidMessageIntentRequest"];
export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];
export type PaidMessageIntent = components["schemas"]["PaidMessageIntent"];
export type ConversationReadState = components["schemas"]["ConversationReadState"];
export type CreateDirectConversationRequest = components["schemas"]["CreateDirectConversationRequest"];
export type RespondToMessageRequest = components["schemas"]["RespondToMessageRequest"];

export interface ListConversationsInput {
  supabaseUserId: string;
}

export interface ConversationInput {
  supabaseUserId: string;
  conversationId: string;
}

export interface CreateMessageInput extends ConversationInput {
  body: string;
  idempotencyKey: string;
}

export interface CreateDirectConversationInput {
  supabaseUserId: string;
  targetUserId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface RespondToMessageRequestInput extends ConversationInput {
  action: "accept" | "decline";
  idempotencyKey: string;
  requestHash: string;
}

export interface MarkConversationReadInput extends ConversationInput {
  idempotencyKey: string;
  requestHash: string;
}

export interface CreatePaidMessageDraftInput extends ConversationInput {
  paymentIntentId: string;
  body: string;
  amountMinor: number;
  currency: "SOL";
}

export interface ConversationPrice {
  conversationId: string;
  amountMinor: number;
  currency: "SOL";
  recipientUserId: string;
}

export interface MessageRepository {
  listConversations(input: ListConversationsInput): Promise<{ items: Conversation[] }>;
  listMessages(input: ConversationInput): Promise<MessagePage | null>;
  createDirectConversation(input: CreateDirectConversationInput): Promise<Conversation | null>;
  respondToMessageRequest(input: RespondToMessageRequestInput): Promise<Conversation | null>;
  markConversationRead(input: MarkConversationReadInput): Promise<ConversationReadState | null>;
  createMessage(input: CreateMessageInput): Promise<Message | null>;
  findConversationPrice(input: ConversationInput): Promise<ConversationPrice | null>;
  recordPaidMessageDraft(input: CreatePaidMessageDraftInput): Promise<void>;
  close?(): Promise<void>;
}
