"use client";

import {
  authenticatedEmptyMutation,
  authenticatedGet,
  authenticatedMutation,
  publicMutation
} from "./api-mutation-transport";
export { ApiMutationError } from "./api-mutation-types";
export type {
  AccessPassIntent,
  AgeSession,
  ContentItem,
  ContentUnlockIntent,
  BlockState,
  Comment,
  CommentPage,
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  EngagementState,
  FeedPreferences,
  HideFeedCreatorRequest,
  ModerationIntake,
  ShareResult,
  CreateAccessPassIntentRequest,
  CreateAgeSessionRequest,
  CreateVerificationSessionRequest,
  CreateContentRequest,
  CreateMessageRequest,
  CreatePaidMessageIntentRequest,
  CreatePaymentIntentRequest,
  CreateRefundDisputeRequest,
  CreateSubscriptionIntentRequest,
  CreateUploadRequest,
  CreateWalletLinkChallengeRequest,
  CreateWalletAuthChallengeRequest,
  CreateWalletAuthSessionRequest,
  LinkSupabaseRecoveryRequest,
  LinkWalletRequest,
  McpConnection,
  McpOAuthRedirect,
  Message,
  PaidMessageIntent,
  PaymentIntent,
  PublishContentRequest,
  ProfileAvatarUpload,
  RefundDisputeRequest,
  SessionState,
  SubmitSubscriptionAuthorizationRequest,
  Subscription,
  SubscriptionAuthorizationIntent,
  TransactionRequest,
  UpdateContentRequest,
  UpdateProfileRequest,
  UploadProfileAvatarRequest,
  UploadSession,
  VerificationSession,
  User,
  Wallet,
  WalletAuthChallenge,
  WalletAuthSession,
  AuthRecoveryLink,
  WalletLinkChallenge
} from "./api-mutation-types";
import type {
  AccessPassIntent,
  AgeSession,
  ContentItem,
  ContentUnlockIntent,
  BlockState,
  Comment,
  CommentPage,
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  EngagementState,
  FeedPreferences,
  HideFeedCreatorRequest,
  ModerationIntake,
  ShareResult,
  CreateAccessPassIntentRequest,
  CreateAgeSessionRequest,
  CreateVerificationSessionRequest,
  CreateContentRequest,
  CreateMessageRequest,
  CreatePaidMessageIntentRequest,
  CreatePaymentIntentRequest,
  CreateRefundDisputeRequest,
  CreateSubscriptionIntentRequest,
  CreateUploadRequest,
  CreateWalletLinkChallengeRequest,
  CreateWalletAuthChallengeRequest,
  CreateWalletAuthSessionRequest,
  LinkSupabaseRecoveryRequest,
  LinkWalletRequest,
  McpConnection,
  McpOAuthRedirect,
  Message,
  PaidMessageIntent,
  PaymentIntent,
  PublishContentRequest,
  ProfileAvatarUpload,
  RefundDisputeRequest,
  SessionState,
  SubmitSubscriptionAuthorizationRequest,
  Subscription,
  SubscriptionAuthorizationIntent,
  TransactionRequest,
  UpdateContentRequest,
  UpdateProfileRequest,
  UploadProfileAvatarRequest,
  UploadSession,
  VerificationSession,
  User,
  Wallet,
  WalletAuthChallenge,
  WalletAuthSession,
  AuthRecoveryLink,
  WalletLinkChallenge
} from "./api-mutation-types";

export async function createAgeSession(body: CreateAgeSessionRequest): Promise<AgeSession> {
  return authenticatedMutation<AgeSession>("/v1/age/sessions", "POST", body);
}

export async function getCurrentSession(): Promise<SessionState> {
  return authenticatedGet<SessionState>("/v1/session");
}

export async function createVerificationSession(
  body: CreateVerificationSessionRequest
): Promise<VerificationSession> {
  return authenticatedMutation<VerificationSession>("/v1/verification/sessions", "POST", body);
}

export async function updateMyProfile(body: UpdateProfileRequest): Promise<User> {
  return authenticatedMutation<User>("/v1/profiles/me", "PATCH", body);
}

export async function createStarterProfile(): Promise<User> {
  return authenticatedMutation<User>("/v1/profiles/me/starter", "POST", {});
}

export async function uploadMyProfileAvatar(
  body: UploadProfileAvatarRequest
): Promise<ProfileAvatarUpload> {
  return authenticatedMutation<ProfileAvatarUpload>("/v1/profiles/me/avatar", "POST", body);
}

export async function createWalletAuthChallenge(
  body: CreateWalletAuthChallengeRequest
): Promise<WalletAuthChallenge> {
  return publicMutation<WalletAuthChallenge>("/v1/auth/wallet/challenges", "POST", body);
}

export async function createWalletAuthSession(
  body: CreateWalletAuthSessionRequest
): Promise<WalletAuthSession> {
  return publicMutation<WalletAuthSession>("/v1/auth/wallet/sessions", "POST", body);
}

export async function revokeWalletAuthSession(): Promise<void> {
  return authenticatedEmptyMutation("/v1/auth/wallet/logout", "POST", {});
}

export async function linkSupabaseRecovery(
  body: LinkSupabaseRecoveryRequest
): Promise<AuthRecoveryLink> {
  return authenticatedMutation<AuthRecoveryLink>("/v1/auth/recovery-link", "POST", body);
}

export async function createWalletLinkChallenge(
  body: CreateWalletLinkChallengeRequest
): Promise<WalletLinkChallenge> {
  return authenticatedMutation<WalletLinkChallenge>("/v1/wallets/link-challenges", "POST", body);
}

export async function linkWallet(body: LinkWalletRequest): Promise<Wallet> {
  return authenticatedMutation<Wallet>("/v1/wallets/link", "POST", body);
}

export async function createContentDraft(
  body: CreateContentRequest,
  idempotencyKey?: string
): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>("/v1/content", "POST", body, idempotencyKey);
}

export async function updateContent(
  contentId: string,
  body: UpdateContentRequest
): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>(
    `/v1/content/${encodeURIComponent(contentId)}`,
    "PATCH",
    body
  );
}

export async function publishContent(
  contentId: string,
  body: PublishContentRequest
): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>(
    `/v1/content/${encodeURIComponent(contentId)}/publish`,
    "POST",
    body
  );
}

export async function createMediaUpload(body: CreateUploadRequest): Promise<UploadSession> {
  return authenticatedMutation<UploadSession>("/v1/media/uploads", "POST", body);
}

export async function syncMediaAsset(mediaAssetId: string): Promise<void> {
  await authenticatedEmptyMutation(
    `/v1/media/assets/${encodeURIComponent(mediaAssetId)}/sync`,
    "POST",
    {}
  );
}

export async function getContentForMutation(contentId: string): Promise<ContentItem> {
  return authenticatedGet<ContentItem>(`/v1/content/${encodeURIComponent(contentId)}`);
}

export async function createContentUnlockIntent(contentId: string): Promise<ContentUnlockIntent> {
  return authenticatedMutation<ContentUnlockIntent>(
    `/v1/content/${encodeURIComponent(contentId)}/unlock-intents`,
    "POST",
    {}
  );
}

export async function toggleContentLike(
  contentId: string,
  idempotencyKey: string
): Promise<EngagementState> {
  return authenticatedMutation<EngagementState>(
    `/v1/engagement/${encodeURIComponent(contentId)}/like`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function toggleContentSave(
  contentId: string,
  idempotencyKey: string
): Promise<EngagementState> {
  return authenticatedMutation<EngagementState>(
    `/v1/engagement/${encodeURIComponent(contentId)}/save`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function getContentComments(contentId: string): Promise<CommentPage> {
  return authenticatedGet<CommentPage>(
    `/v1/engagement/${encodeURIComponent(contentId)}/comments`
  );
}

export async function createContentComment(
  contentId: string,
  body: CreateCommentRequest,
  idempotencyKey: string
): Promise<Comment> {
  return authenticatedMutation<Comment>(
    `/v1/engagement/${encodeURIComponent(contentId)}/comments`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function createContentShare(
  body: CreateShareRequest,
  idempotencyKey: string
): Promise<ShareResult> {
  return authenticatedMutation<ShareResult>("/v1/shares", "POST", body, idempotencyKey);
}

export async function createSafetyReport(
  body: CreateReportRequest,
  idempotencyKey: string
): Promise<ModerationIntake> {
  return authenticatedMutation<ModerationIntake>("/v1/reports", "POST", body, idempotencyKey);
}

export async function hideFeedCreator(
  body: HideFeedCreatorRequest,
  idempotencyKey: string
): Promise<FeedPreferences> {
  return authenticatedMutation<FeedPreferences>(
    "/v1/feed/hide-creator",
    "POST",
    body,
    idempotencyKey
  );
}

export async function blockUser(userId: string, idempotencyKey: string): Promise<BlockState> {
  return authenticatedMutation<BlockState>(
    `/v1/blocks/${encodeURIComponent(userId)}`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function createLiveEventAccessIntent(liveRoomId: string): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/event-access-intents`,
    "POST",
    {}
  );
}

export async function createEventAccessPassIntent(
  eventId: string,
  body: CreateAccessPassIntentRequest
): Promise<AccessPassIntent> {
  return authenticatedMutation<AccessPassIntent>(
    `/v1/events/${encodeURIComponent(eventId)}/access-passes/intents`,
    "POST",
    body
  );
}

export async function createMessage(
  conversationId: string,
  body: CreateMessageRequest,
  idempotencyKey?: string
): Promise<Message> {
  return authenticatedMutation<Message>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function createPaidMessageIntent(
  conversationId: string,
  body: CreatePaidMessageIntentRequest,
  idempotencyKey?: string
): Promise<PaidMessageIntent> {
  return authenticatedMutation<PaidMessageIntent>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/paid-message-intents`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function createPaymentIntent(body: CreatePaymentIntentRequest): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>("/v1/payments/intents", "POST", body);
}

export async function getPaymentTransactionRequest(paymentIntentId: string): Promise<TransactionRequest> {
  return authenticatedGet<TransactionRequest>(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}/transaction-request`
  );
}

export async function createSubscriptionIntent(
  body: CreateSubscriptionIntentRequest
): Promise<SubscriptionAuthorizationIntent> {
  return authenticatedMutation<SubscriptionAuthorizationIntent>("/v1/subscriptions/intents", "POST", body);
}

export async function submitSubscriptionAuthorization(
  authorizationIntentId: string,
  body: SubmitSubscriptionAuthorizationRequest
): Promise<Subscription> {
  return authenticatedMutation<Subscription>(
    `/v1/subscriptions/authorizations/${encodeURIComponent(authorizationIntentId)}/submissions`,
    "POST",
    body
  );
}

export async function cancelSubscription(subscriptionId: string): Promise<Subscription> {
  return authenticatedMutation<Subscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    "PATCH",
    {}
  );
}

export async function createRefundDisputeRequest(
  body: CreateRefundDisputeRequest
): Promise<RefundDisputeRequest> {
  return authenticatedMutation<RefundDisputeRequest>("/v1/refunds/requests", "POST", body);
}

export async function approveMcpConsentRequest(requestId: string): Promise<McpOAuthRedirect> {
  return authenticatedMutation<McpOAuthRedirect>(
    `/oauth/consent/${encodeURIComponent(requestId)}/approve`,
    "POST",
    {}
  );
}

export async function denyMcpConsentRequest(requestId: string): Promise<McpOAuthRedirect> {
  return authenticatedMutation<McpOAuthRedirect>(
    `/oauth/consent/${encodeURIComponent(requestId)}/deny`,
    "POST",
    {}
  );
}

export async function revokeMcpConnection(connectionId: string): Promise<McpConnection> {
  return authenticatedMutation<McpConnection>(
    `/v1/mcp/connections/${encodeURIComponent(connectionId)}/revoke`,
    "POST",
    {}
  );
}
