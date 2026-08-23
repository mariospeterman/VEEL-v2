"use client";

import {
  anonymousEmptyMutation,
  authenticatedBinaryMutation,
  authenticatedEmptyMutation,
  authenticatedGet,
  authenticatedMutation,
  publicCapabilityMutation,
  publicMutation
} from "./api-mutation-transport";
export { ApiMutationError } from "./api-mutation-types";
export type {
  OnboardingAnalyticsEventRequest,
  AccessPassIntent,
  AgeSession,
  ContentItem,
  ContentPoll,
  ContentUnlockIntent,
  BlockState,
  Comment,
  CommentPage,
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  EngagementState,
  FeedPreferences,
  UpdateFeedPreferencesRequest,
  FeedPage,
  FollowState,
  HideFeedCreatorRequest,
  RecordFeedImpressionRequest,
  MutualsInterestRequest,
  MutualsInterestResult,
  ModerationIntake,
  ShareResult,
  CreateAccessPassIntentRequest,
  CreateAgeSessionRequest,
  CreateVerificationSessionRequest,
  CreateContentRequest,
  CreateMessageRequest,
  ConversationCommercialInteractions,
  CreateCreatorMediaOfferRequest,
  CreateStructuredCreatorRequestRequest,
  CreatorMediaOffer,
  StructuredCreatorRequest,
  UpdateStructuredCreatorRequestRequest,
  CreatePaymentIntentRequest,
  CreateRefundDisputeRequest,
  CreateSubscriptionIntentRequest,
  CreateUploadRequest,
  CreateWalletLinkChallengeRequest,
  CreateWalletAuthChallengeRequest,
  CreateWalletAuthSessionRequest,
  ApplicationSessionExpiry,
  RealtimeAccessToken,
  RealtimeConnectionEventRequest,
  Conversation,
  ConversationReadState,
  CreateDirectConversationRequest,
  RespondToMessageRequest,
  UpdateConversationMuteRequest,
  Notification,
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
  NotificationDevice,
  RegisterNotificationDeviceRequest,
  LinkWalletRequest,
  McpConnection,
  McpOAuthRedirect,
  Message,
  MediaModerationAppeal,
  CreatorMediaPage,
  PaymentIntent,
  PublishContentRequest,
  ProfileAvatarUpload,
  RefundDisputeRequest,
  SessionState,
  SubmitSubscriptionAuthorizationRequest,
  Subscription,
  SubscriptionAuthorizationIntent,
  SubscriptionAuthorizationTransaction,
  TransactionRequest,
  TransactionRequestPostResponse,
  AcceptPaymentIntentTermsRequest,
  UpdateContentRequest,
  VoteOnContentPollRequest,
  UpdateProfileRequest,
  UpdateCreatorOnboardingRequest,
  UpsertCreatorMembershipOfferRequest,
  UploadProfileAvatarRequest,
  UploadSession,
  ImageAssetUploadResult,
  UpdateContentMediaAssetRequest,
  ContentMediaAssetMutationResult,
  RetireContentMediaAssetRequest,
  RetireContentMediaAssetResult,
  VerificationSession,
  User,
  CreatorOnboarding,
  Wallet,
  WalletAuthChallenge,
  WalletAuthSession,
  WalletLinkChallenge,
  CreateLiveRoomRequest,
  HostConnection,
  LiveChatMessage,
  LiveChatPage,
  LiveRoom,
  LiveRoomPage,
  RevealedHostConnection,
  OrganizationMember,
  InviteOrganizationMemberRequest,
  OrganizationMembershipDecision,
  UpdateOrganizationMemberRequest,
  ManagedCreatorRelationship,
  InviteManagedCreatorRequest,
  ManagedCreatorAgreementTerms,
  ManagedCreatorAgreementDecision,
  ManagedCreatorTerminationRequest
} from "./api-mutation-types";
import type {
  OnboardingAnalyticsEventRequest,
  AccessPassIntent,
  AgeSession,
  ContentItem,
  ContentPoll,
  ContentUnlockIntent,
  BlockState,
  Comment,
  CommentPage,
  CreateCommentRequest,
  CreateReportRequest,
  CreateShareRequest,
  EngagementState,
  FeedPreferences,
  UpdateFeedPreferencesRequest,
  FeedPage,
  FollowState,
  HideFeedCreatorRequest,
  RecordFeedImpressionRequest,
  MutualsInterestRequest,
  MutualsInterestResult,
  ModerationIntake,
  ShareResult,
  CreateAccessPassIntentRequest,
  CreateAgeSessionRequest,
  CreateVerificationSessionRequest,
  CreateContentRequest,
  CreateMessageRequest,
  ConversationCommercialInteractions,
  CreateCreatorMediaOfferRequest,
  CreateStructuredCreatorRequestRequest,
  CreatorMediaOffer,
  StructuredCreatorRequest,
  UpdateStructuredCreatorRequestRequest,
  CreatePaymentIntentRequest,
  CreateRefundDisputeRequest,
  CreateSubscriptionIntentRequest,
  CreateUploadRequest,
  CreateWalletLinkChallengeRequest,
  CreateWalletAuthChallengeRequest,
  CreateWalletAuthSessionRequest,
  ApplicationSessionExpiry,
  RealtimeAccessToken,
  RealtimeConnectionEventRequest,
  Conversation,
  ConversationReadState,
  CreateDirectConversationRequest,
  RespondToMessageRequest,
  UpdateConversationMuteRequest,
  Notification,
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
  NotificationDevice,
  RegisterNotificationDeviceRequest,
  LinkWalletRequest,
  McpConnection,
  McpOAuthRedirect,
  Message,
  MediaModerationAppeal,
  CreatorMediaPage,
  PaymentIntent,
  PublishContentRequest,
  ProfileAvatarUpload,
  RefundDisputeRequest,
  SessionState,
  SubmitSubscriptionAuthorizationRequest,
  Subscription,
  SubscriptionAuthorizationIntent,
  SubscriptionAuthorizationTransaction,
  TransactionRequest,
  TransactionRequestPostResponse,
  AcceptPaymentIntentTermsRequest,
  UpdateContentRequest,
  VoteOnContentPollRequest,
  UpdateProfileRequest,
  UpdateCreatorOnboardingRequest,
  UpsertCreatorMembershipOfferRequest,
  UploadProfileAvatarRequest,
  UploadSession,
  ImageAssetUploadResult,
  UpdateContentMediaAssetRequest,
  ContentMediaAssetMutationResult,
  RetireContentMediaAssetRequest,
  RetireContentMediaAssetResult,
  VerificationSession,
  User,
  CreatorOnboarding,
  Wallet,
  WalletAuthChallenge,
  WalletAuthSession,
  WalletLinkChallenge,
  CreateLiveRoomRequest,
  HostConnection,
  LiveChatMessage,
  LiveChatPage,
  LiveRoom,
  LiveRoomPage,
  RevealedHostConnection,
  OrganizationMember,
  InviteOrganizationMemberRequest,
  OrganizationMembershipDecision,
  UpdateOrganizationMemberRequest,
  ManagedCreatorRelationship,
  InviteManagedCreatorRequest,
  ManagedCreatorAgreementTerms,
  ManagedCreatorAgreementDecision,
  ManagedCreatorTerminationRequest
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

export async function updateMyCreatorOnboarding(
  body: UpdateCreatorOnboardingRequest,
  idempotencyKey?: string
): Promise<CreatorOnboarding> {
  return authenticatedMutation<CreatorOnboarding>(
    "/v1/profiles/me/creator-onboarding",
    "PATCH",
    body,
    idempotencyKey
  );
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

export async function recordOnboardingAnalyticsEvent(
  body: OnboardingAnalyticsEventRequest
): Promise<void> {
  return anonymousEmptyMutation(
    "/v1/analytics/onboarding-events",
    body,
    body.idempotencyKey
  );
}

export async function revokeWalletAuthSession(): Promise<void> {
  return authenticatedEmptyMutation("/v1/auth/wallet/logout", "POST", {});
}

export async function revokeAllApplicationSessions(): Promise<void> {
  return authenticatedEmptyMutation("/v1/auth/sessions/logout-all", "POST", {});
}

export async function createRealtimeAccessToken(): Promise<RealtimeAccessToken> {
  return authenticatedMutation<RealtimeAccessToken>("/v1/realtime/token", "POST", {});
}

export async function recordRealtimeConnectionEvent(
  body: RealtimeConnectionEventRequest
): Promise<void> {
  return authenticatedEmptyMutation("/v1/realtime/telemetry", "POST", body);
}

export async function createRecoveryLinkIntent(): Promise<ApplicationSessionExpiry> {
  return authenticatedMutation<ApplicationSessionExpiry>("/v1/auth/recovery/link-intents", "POST", {});
}

export async function unlinkRecoveryIdentity(): Promise<ApplicationSessionExpiry> {
  return authenticatedMutation<ApplicationSessionExpiry>("/v1/auth/recovery/unlink", "POST", {});
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

export async function voteOnContentPoll(
  contentId: string,
  body: VoteOnContentPollRequest,
  idempotencyKey: string
): Promise<ContentPoll> {
  return authenticatedMutation<ContentPoll>(
    `/v1/content/${encodeURIComponent(contentId)}/poll-votes`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function createContentModerationAppeal(
  contentId: string,
  reason: string
): Promise<MediaModerationAppeal> {
  return authenticatedMutation<MediaModerationAppeal>(
    `/v1/content/${encodeURIComponent(contentId)}/moderation-appeals`,
    "POST",
    { reason }
  );
}

export async function getMyContentPage(cursor: string): Promise<CreatorMediaPage> {
  return authenticatedGet<CreatorMediaPage>(
    `/v1/content/mine?cursor=${encodeURIComponent(cursor)}`
  );
}

export async function createMediaUpload(
  body: CreateUploadRequest,
  idempotencyKey?: string
): Promise<UploadSession> {
  return authenticatedMutation<UploadSession>("/v1/media/uploads", "POST", body, idempotencyKey);
}

export async function uploadContentImageAsset(
  contentId: string,
  file: File,
  idempotencyKey?: string
): Promise<ImageAssetUploadResult> {
  return authenticatedBinaryMutation<ImageAssetUploadResult>(
    `/v1/content/${encodeURIComponent(contentId)}/image-assets`,
    file,
    idempotencyKey
  );
}

export async function updateContentMediaAsset(
  mediaAssetId: string,
  body: UpdateContentMediaAssetRequest,
  idempotencyKey?: string
): Promise<ContentMediaAssetMutationResult> {
  return authenticatedMutation<ContentMediaAssetMutationResult>(
    `/v1/media/assets/${encodeURIComponent(mediaAssetId)}`,
    "PATCH",
    body,
    idempotencyKey
  );
}

export async function retireContentMediaAsset(
  mediaAssetId: string,
  body: RetireContentMediaAssetRequest,
  idempotencyKey?: string
): Promise<RetireContentMediaAssetResult> {
  return authenticatedMutation<RetireContentMediaAssetResult>(
    `/v1/media/assets/${encodeURIComponent(mediaAssetId)}`,
    "DELETE",
    body,
    idempotencyKey
  );
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

export async function createContentUnlockIntent(
  contentId: string,
  idempotencyKey?: string
): Promise<ContentUnlockIntent> {
  return authenticatedMutation<ContentUnlockIntent>(
    `/v1/content/${encodeURIComponent(contentId)}/unlock-intents`,
    "POST",
    {},
    idempotencyKey
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

export async function updateFeedPreferences(
  body: UpdateFeedPreferencesRequest,
  idempotencyKey: string
): Promise<FeedPreferences> {
  return authenticatedMutation<FeedPreferences>(
    "/v1/feed/preferences",
    "PATCH",
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

export async function getFeedPage(
  mode: "recommended" | "following",
  surface: "home" | "bits",
  cursor?: string
): Promise<FeedPage> {
  const query = new URLSearchParams({ mode, surface });
  if (cursor) query.set("cursor", cursor);
  return authenticatedGet<FeedPage>(`/v1/content/feed?${query.toString()}`);
}

export async function followUser(userId: string, idempotencyKey: string): Promise<FollowState> {
  return authenticatedMutation<FollowState>(
    `/v1/follows/${encodeURIComponent(userId)}`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function unfollowUser(userId: string, idempotencyKey: string): Promise<FollowState> {
  return authenticatedMutation<FollowState>(
    `/v1/follows/${encodeURIComponent(userId)}`,
    "DELETE",
    {},
    idempotencyKey
  );
}

export async function recordFeedImpression(
  body: RecordFeedImpressionRequest,
  idempotencyKey: string
): Promise<void> {
  await authenticatedEmptyMutation("/v1/feed/impressions", "POST", body, idempotencyKey);
}

export async function createLiveEventAccessIntent(
  liveRoomId: string,
  idempotencyKey?: string
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/event-access-intents`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function createLiveRoom(
  body: CreateLiveRoomRequest,
  idempotencyKey?: string
): Promise<LiveRoom> {
  return authenticatedMutation<LiveRoom>("/v1/live/rooms", "POST", body, idempotencyKey);
}

export async function getMyLiveRoomsForMutation(): Promise<LiveRoomPage> {
  return authenticatedGet<LiveRoomPage>("/v1/live/rooms/mine");
}

export async function getLiveHostConnection(liveRoomId: string): Promise<HostConnection> {
  return authenticatedGet<HostConnection>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/host-connection`
  );
}

export async function revealLiveHostConnection(
  liveRoomId: string,
  idempotencyKey?: string
): Promise<RevealedHostConnection> {
  return authenticatedMutation<RevealedHostConnection>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/host-connection/reveal`,
    "POST",
    { acknowledgement: "i_understand_stream_keys_are_secrets" },
    idempotencyKey
  );
}

export async function syncLiveRoom(liveRoomId: string): Promise<LiveRoom> {
  return authenticatedMutation<LiveRoom>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/sync`,
    "POST",
    {}
  );
}

export async function endLiveRoom(liveRoomId: string, idempotencyKey?: string): Promise<void> {
  await authenticatedEmptyMutation(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/end`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function getLiveChatMessages(liveRoomId: string): Promise<LiveChatPage> {
  return authenticatedGet<LiveChatPage>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/messages`
  );
}

export async function createLiveChatMessage(
  liveRoomId: string,
  body: string,
  idempotencyKey?: string
): Promise<LiveChatMessage> {
  return authenticatedMutation<LiveChatMessage>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/messages`,
    "POST",
    { body },
    idempotencyKey
  );
}

export async function createEventAccessPassIntent(
  eventId: string,
  body: CreateAccessPassIntentRequest,
  idempotencyKey?: string
): Promise<AccessPassIntent> {
  return authenticatedMutation<AccessPassIntent>(
    `/v1/events/${encodeURIComponent(eventId)}/access-passes/intents`,
    "POST",
    body,
    idempotencyKey
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

export async function getConversationsForMutation(): Promise<{ items: Conversation[] }> {
  return authenticatedGet<{ items: Conversation[] }>("/v1/messages/conversations");
}

export async function getConversationMessagesForMutation(conversationId: string): Promise<{ items: Message[] }> {
  return authenticatedGet<{ items: Message[] }>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`
  );
}

export async function getConversationCommercialInteractions(
  conversationId: string
): Promise<ConversationCommercialInteractions> {
  return authenticatedGet<ConversationCommercialInteractions>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/commercial-interactions`
  );
}

export async function createCreatorMediaOffer(
  conversationId: string,
  body: CreateCreatorMediaOfferRequest
): Promise<CreatorMediaOffer> {
  return authenticatedMutation<CreatorMediaOffer>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/media-offers`,
    "POST",
    body
  );
}

export async function updateCreatorMediaOffer(
  conversationId: string,
  offerId: string,
  action: "decline" | "withdraw"
): Promise<CreatorMediaOffer> {
  return authenticatedMutation<CreatorMediaOffer>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/media-offers/${encodeURIComponent(offerId)}`,
    "PATCH",
    { action }
  );
}

export async function createCreatorMediaOfferPaymentIntent(
  conversationId: string,
  offerId: string,
  idempotencyKey?: string
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/media-offers/${encodeURIComponent(offerId)}/payment-intents`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function createStructuredCreatorRequest(
  conversationId: string,
  body: CreateStructuredCreatorRequestRequest
): Promise<StructuredCreatorRequest> {
  return authenticatedMutation<StructuredCreatorRequest>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/creator-requests`,
    "POST",
    body
  );
}

export async function updateStructuredCreatorRequest(
  conversationId: string,
  requestId: string,
  body: UpdateStructuredCreatorRequestRequest
): Promise<StructuredCreatorRequest> {
  return authenticatedMutation<StructuredCreatorRequest>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/creator-requests/${encodeURIComponent(requestId)}`,
    "PATCH",
    body
  );
}

export async function createStructuredCreatorRequestPaymentIntent(
  conversationId: string,
  requestId: string,
  idempotencyKey?: string
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/creator-requests/${encodeURIComponent(requestId)}/payment-intents`,
    "POST",
    {},
    idempotencyKey
  );
}

export async function createDirectConversation(
  body: CreateDirectConversationRequest
): Promise<Conversation> {
  return authenticatedMutation<Conversation>("/v1/messages/conversations", "POST", body);
}

export async function respondToMessageRequest(
  conversationId: string,
  body: RespondToMessageRequest
): Promise<Conversation> {
  return authenticatedMutation<Conversation>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/request`,
    "PATCH",
    body
  );
}

export async function markConversationRead(
  conversationId: string
): Promise<ConversationReadState> {
  return authenticatedMutation<ConversationReadState>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/read`,
    "PATCH",
    {}
  );
}

export async function updateConversationMute(
  conversationId: string,
  body: UpdateConversationMuteRequest
): Promise<Conversation> {
  return authenticatedMutation<Conversation>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/mute`,
    "PATCH",
    body
  );
}

export async function updateMessageReaction(
  conversationId: string,
  messageId: string,
  reactionKey: "like" | "love" | "laugh" | "support",
  reacted: boolean
): Promise<Message> {
  return authenticatedMutation<Message>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions/${reactionKey}`,
    reacted ? "PUT" : "DELETE",
    {}
  );
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  return authenticatedMutation<Notification>(
    `/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    "PATCH",
    {}
  );
}

export async function updateNotificationPreferences(
  body: UpdateNotificationPreferencesRequest
): Promise<NotificationPreferences> {
  return authenticatedMutation<NotificationPreferences>(
    "/v1/notifications/preferences",
    "PATCH",
    body
  );
}

export async function registerNotificationDevice(
  body: RegisterNotificationDeviceRequest
): Promise<NotificationDevice> {
  return authenticatedMutation<NotificationDevice>("/v1/notifications/devices", "POST", body);
}

export async function createPaymentIntent(
  body: CreatePaymentIntentRequest,
  idempotencyKey?: string
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    "/v1/payments/intents",
    "POST",
    body,
    idempotencyKey
  );
}

export async function getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
  return authenticatedGet<PaymentIntent>(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}`
  );
}

export async function acceptPaymentIntentTerms(
  paymentIntentId: string,
  body: AcceptPaymentIntentTermsRequest,
  idempotencyKey?: string
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}/consent`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function getPaymentTransactionRequest(paymentIntentId: string): Promise<TransactionRequest> {
  return authenticatedGet<TransactionRequest>(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}/transaction-request`
  );
}

export async function createSolanaPayCheckoutTransaction(
  checkoutUrl: string,
  account: string
): Promise<TransactionRequestPostResponse> {
  return publicCapabilityMutation<TransactionRequestPostResponse>(checkoutUrl, { account });
}

export async function submitPaymentSignature(
  paymentIntentId: string,
  signature: string,
  idempotencyKey?: string
): Promise<void> {
  return authenticatedEmptyMutation(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}/submissions`,
    "POST",
    { signature },
    idempotencyKey
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

export async function getSubscriptionAuthorizationTransaction(
  authorizationIntentId: string
): Promise<SubscriptionAuthorizationTransaction> {
  return authenticatedGet<SubscriptionAuthorizationTransaction>(
    `/v1/subscriptions/authorizations/${encodeURIComponent(authorizationIntentId)}/transaction`
  );
}

export async function cancelSubscription(subscriptionId: string): Promise<Subscription> {
  return authenticatedMutation<Subscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    "PATCH",
    {}
  );
}

export async function upsertCreatorMembershipOffer(
  body: UpsertCreatorMembershipOfferRequest
): Promise<import("./api-client-types").SubscriptionPlan> {
  return authenticatedMutation<import("./api-client-types").SubscriptionPlan>(
    "/v1/subscriptions/creator-offer",
    "PUT",
    body
  );
}

export async function disableCreatorMembershipOffer(): Promise<void> {
  return authenticatedEmptyMutation("/v1/subscriptions/creator-offer", "DELETE", {});
}

export async function createRefundDisputeRequest(
  body: CreateRefundDisputeRequest
): Promise<RefundDisputeRequest> {
  return authenticatedMutation<RefundDisputeRequest>("/v1/refunds/requests", "POST", body);
}

export async function createMutualsInterest(
  body: MutualsInterestRequest,
  idempotencyKey?: string
): Promise<MutualsInterestResult> {
  return authenticatedMutation<MutualsInterestResult>(
    "/v1/mutuals/interests",
    "POST",
    body,
    idempotencyKey
  );
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

export async function inviteOrganizationMember(
  organizationId: string,
  body: InviteOrganizationMemberRequest,
  idempotencyKey?: string
): Promise<OrganizationMember> {
  return authenticatedMutation<OrganizationMember>(
    `/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function respondToOrganizationMembership(
  membershipId: string,
  body: OrganizationMembershipDecision,
  idempotencyKey?: string
): Promise<OrganizationMember> {
  return authenticatedMutation<OrganizationMember>(
    `/v1/organization-memberships/${encodeURIComponent(membershipId)}/responses`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function updateOrganizationMember(
  organizationId: string,
  membershipId: string,
  body: UpdateOrganizationMemberRequest,
  idempotencyKey?: string
): Promise<OrganizationMember> {
  return authenticatedMutation<OrganizationMember>(
    `/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    "PATCH",
    body,
    idempotencyKey
  );
}

export async function inviteManagedCreator(
  organizationId: string,
  body: InviteManagedCreatorRequest,
  idempotencyKey?: string
): Promise<ManagedCreatorRelationship> {
  return authenticatedMutation<ManagedCreatorRelationship>(
    `/v1/organizations/${encodeURIComponent(organizationId)}/managed-creators`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function respondToManagedCreatorRelationship(
  relationshipId: string,
  decision: "accept" | "decline",
  idempotencyKey?: string
): Promise<ManagedCreatorRelationship> {
  return authenticatedMutation<ManagedCreatorRelationship>(
    `/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/responses`,
    "POST",
    { decision },
    idempotencyKey
  );
}

export async function proposeManagedCreatorAgreement(
  relationshipId: string,
  body: ManagedCreatorAgreementTerms,
  idempotencyKey?: string
): Promise<ManagedCreatorRelationship> {
  return authenticatedMutation<ManagedCreatorRelationship>(
    `/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/agreements`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function respondToManagedCreatorAgreement(
  relationshipId: string,
  agreementId: string,
  body: ManagedCreatorAgreementDecision,
  idempotencyKey?: string
): Promise<ManagedCreatorRelationship> {
  return authenticatedMutation<ManagedCreatorRelationship>(
    `/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/agreements/${encodeURIComponent(agreementId)}/responses`,
    "POST",
    body,
    idempotencyKey
  );
}

export async function terminateManagedCreatorRelationship(
  relationshipId: string,
  body: ManagedCreatorTerminationRequest,
  idempotencyKey?: string
): Promise<ManagedCreatorRelationship> {
  return authenticatedMutation<ManagedCreatorRelationship>(
    `/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/termination`,
    "POST",
    body,
    idempotencyKey
  );
}
