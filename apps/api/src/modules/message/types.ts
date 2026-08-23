import type { components } from "@veel/contracts";

export type Conversation = components["schemas"]["Conversation"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];
export type ConversationReadState = components["schemas"]["ConversationReadState"];
export type CreateDirectConversationRequest = components["schemas"]["CreateDirectConversationRequest"];
export type RespondToMessageRequest = components["schemas"]["RespondToMessageRequest"];
export type UpdateConversationMuteRequest = components["schemas"]["UpdateConversationMuteRequest"];
export type MessageReactionKey = components["schemas"]["Message"]["reactions"][number]["key"];
export type ConversationCommercialInteractions = components["schemas"]["ConversationCommercialInteractions"];
export type CreatorMediaOffer = components["schemas"]["CreatorMediaOffer"];
export type CreateCreatorMediaOfferRequest = components["schemas"]["CreateCreatorMediaOfferRequest"];
export type UpdateCreatorMediaOfferRequest = components["schemas"]["UpdateCreatorMediaOfferRequest"];
export type StructuredCreatorRequest = components["schemas"]["StructuredCreatorRequest"];
export type CreateStructuredCreatorRequestRequest = components["schemas"]["CreateStructuredCreatorRequestRequest"];
export type UpdateStructuredCreatorRequestRequest = components["schemas"]["UpdateStructuredCreatorRequestRequest"];

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
  replyToMessageId?: string | null;
  sharedContentItemId?: string | null;
  attachmentContentItemIds?: string[];
}

export interface UpdateConversationMuteInput extends ConversationInput {
  muted: boolean;
  idempotencyKey: string;
  requestHash: string;
}

export interface UpdateMessageReactionInput extends ConversationInput {
  messageId: string;
  reactionKey: MessageReactionKey;
  reacted: boolean;
}

export interface CreateCreatorMediaOfferInput extends ConversationInput {
  body: CreateCreatorMediaOfferRequest;
  idempotencyKey: string;
  requestHash: string;
}

export interface UpdateCreatorMediaOfferInput extends ConversationInput {
  offerId: string;
  action: UpdateCreatorMediaOfferRequest["action"];
  idempotencyKey: string;
  requestHash: string;
}

export interface CreateStructuredCreatorRequestInput extends ConversationInput {
  body: CreateStructuredCreatorRequestRequest;
  idempotencyKey: string;
  requestHash: string;
}

export interface UpdateStructuredCreatorRequestInput extends ConversationInput {
  requestId: string;
  body: UpdateStructuredCreatorRequestRequest;
  idempotencyKey: string;
  requestHash: string;
}

export interface CommercialPaymentAuthority {
  targetId: string;
  paymentIntentId: string | null;
  creatorUserId: string;
  amountMinor: number;
  currency: "SOL" | "USDC";
  productType: "content_unlock" | "paid_message";
}

export interface BindCommercialPaymentIntentInput extends ConversationInput {
  resourceId: string;
  paymentIntentId: string;
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
  updateConversationMute(input: UpdateConversationMuteInput): Promise<Conversation | null>;
  updateMessageReaction(input: UpdateMessageReactionInput): Promise<Message | null>;
  listCommercialInteractions(input: ConversationInput): Promise<ConversationCommercialInteractions | null>;
  createCreatorMediaOffer(input: CreateCreatorMediaOfferInput): Promise<CreatorMediaOffer | null>;
  updateCreatorMediaOffer(input: UpdateCreatorMediaOfferInput): Promise<CreatorMediaOffer | null>;
  findCreatorMediaOfferPaymentAuthority(input: ConversationInput & { offerId: string }): Promise<CommercialPaymentAuthority | null>;
  bindCreatorMediaOfferPaymentIntent(input: BindCommercialPaymentIntentInput): Promise<CreatorMediaOffer | null>;
  createStructuredCreatorRequest(input: CreateStructuredCreatorRequestInput): Promise<StructuredCreatorRequest | null>;
  updateStructuredCreatorRequest(input: UpdateStructuredCreatorRequestInput): Promise<StructuredCreatorRequest | null>;
  findStructuredCreatorRequestPaymentAuthority(input: ConversationInput & { requestId: string }): Promise<CommercialPaymentAuthority | null>;
  bindStructuredCreatorRequestPaymentIntent(input: BindCommercialPaymentIntentInput): Promise<StructuredCreatorRequest | null>;
  createMessage(input: CreateMessageInput): Promise<Message | null>;
  findConversationPrice(input: ConversationInput): Promise<ConversationPrice | null>;
  recordPaidMessageDraft(input: CreatePaidMessageDraftInput): Promise<void>;
  close?(): Promise<void>;
}
