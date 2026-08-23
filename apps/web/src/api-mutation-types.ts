import type { components } from "@veel/contracts";

export type OnboardingAnalyticsEventRequest =
  components["schemas"]["OnboardingAnalyticsEventRequest"];
export type User = components["schemas"]["User"];
export type SessionState = components["schemas"]["SessionState"];
export type CreateAgeSessionRequest = components["schemas"]["CreateAgeSessionRequest"];
export type AgeSession = components["schemas"]["AgeSession"];
export type CreateVerificationSessionRequest =
  components["schemas"]["CreateVerificationSessionRequest"];
export type VerificationSession = components["schemas"]["VerificationSession"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type UploadProfileAvatarRequest = components["schemas"]["UploadProfileAvatarRequest"];
export type ProfileAvatarUpload = components["schemas"]["ProfileAvatarUpload"];
export type UpdateCreatorOnboardingRequest =
  components["schemas"]["UpdateCreatorOnboardingRequest"];
export type CreatorOnboarding = components["schemas"]["CreatorOnboarding"];
export type CreateWalletAuthChallengeRequest =
  components["schemas"]["CreateWalletAuthChallengeRequest"];
export type CreateWalletAuthSessionRequest =
  components["schemas"]["CreateWalletAuthSessionRequest"];
export type WalletAuthChallenge = components["schemas"]["WalletAuthChallenge"];
export type WalletAuthSession = components["schemas"]["WalletAuthSession"];
export type ApplicationSessionExpiry = components["schemas"]["ApplicationSessionExpiry"];
export type RealtimeAccessToken = components["schemas"]["RealtimeAccessToken"];
export type RealtimeConnectionEventRequest = components["schemas"]["RealtimeConnectionEventRequest"];
export type Conversation = components["schemas"]["Conversation"];
export type ConversationReadState = components["schemas"]["ConversationReadState"];
export type CreateDirectConversationRequest = components["schemas"]["CreateDirectConversationRequest"];
export type RespondToMessageRequest = components["schemas"]["RespondToMessageRequest"];
export type UpdateConversationMuteRequest = components["schemas"]["UpdateConversationMuteRequest"];
export type Notification = components["schemas"]["Notification"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type UpdateNotificationPreferencesRequest = components["schemas"]["UpdateNotificationPreferencesRequest"];
export type NotificationDevice = components["schemas"]["NotificationDevice"];
export type RegisterNotificationDeviceRequest = components["schemas"]["RegisterNotificationDeviceRequest"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];
export type Wallet = components["schemas"]["Wallet"];
export type OrganizationMember = components["schemas"]["OrganizationMember"];
export type InviteOrganizationMemberRequest = components["schemas"]["InviteOrganizationMemberRequest"];
export type OrganizationMembershipDecision = components["schemas"]["OrganizationMembershipDecision"];
export type UpdateOrganizationMemberRequest = components["schemas"]["UpdateOrganizationMemberRequest"];
export type ManagedCreatorRelationship = components["schemas"]["ManagedCreatorRelationship"];
export type InviteManagedCreatorRequest = components["schemas"]["InviteManagedCreatorRequest"];
export type ManagedCreatorAgreementTerms = components["schemas"]["ManagedCreatorAgreementTerms"];
export type ManagedCreatorAgreementDecision = components["schemas"]["ManagedCreatorAgreementDecision"];
export type ManagedCreatorTerminationRequest = components["schemas"]["ManagedCreatorTerminationRequest"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type UpdateContentRequest = components["schemas"]["UpdateContentRequest"];
export type PublishContentRequest = components["schemas"]["PublishContentRequest"];
export type ContentItem = components["schemas"]["ContentItem"];
export type ContentPoll = components["schemas"]["ContentPoll"];
export type VoteOnContentPollRequest = components["schemas"]["VoteOnContentPollRequest"];
export type MediaModerationAppeal = components["schemas"]["MediaModerationAppeal"];
export type CreatorMediaPage = components["schemas"]["CreatorMediaPage"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type UploadSession = components["schemas"]["UploadSession"];
export type ImageAssetUploadResult = components["schemas"]["ImageAssetUploadResult"];
export type UpdateContentMediaAssetRequest = components["schemas"]["UpdateContentMediaAssetRequest"];
export type ContentMediaAssetMutationResult = components["schemas"]["ContentMediaAssetMutationResult"];
export type RetireContentMediaAssetRequest = components["schemas"]["RetireContentMediaAssetRequest"];
export type RetireContentMediaAssetResult = components["schemas"]["RetireContentMediaAssetResult"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
export type LiveRoom = components["schemas"]["LiveRoom"];
export type LiveRoomPage = { items: LiveRoom[]; nextCursor?: string | null };
export type CreateLiveRoomRequest = components["schemas"]["CreateLiveRoomRequest"];
export type HostConnection = components["schemas"]["HostConnection"];
export type RevealedHostConnection = components["schemas"]["RevealedHostConnection"];
export type LiveChatMessage = components["schemas"]["LiveChatMessage"];
export type LiveChatPage = components["schemas"]["LiveChatPage"];
export type EngagementState = components["schemas"]["EngagementState"];
export type Comment = components["schemas"]["Comment"];
export type CommentPage = components["schemas"]["CommentPage"];
export type CreateCommentRequest = components["schemas"]["CreateCommentRequest"];
export type CreateShareRequest = components["schemas"]["CreateShareRequest"];
export type ShareResult = components["schemas"]["ShareResult"];
export type CreateReportRequest = components["schemas"]["CreateReportRequest"];
export type ModerationIntake = components["schemas"]["ModerationIntake"];
export type HideFeedCreatorRequest = components["schemas"]["HideFeedCreatorRequest"];
export type FeedPreferences = components["schemas"]["FeedPreferences"];
export type UpdateFeedPreferencesRequest = components["schemas"]["UpdateFeedPreferencesRequest"];
export type BlockState = components["schemas"]["BlockState"];
export type FollowState = components["schemas"]["FollowState"];
export type FeedPage = components["schemas"]["FeedPage"];
export type RecordFeedImpressionRequest = components["schemas"]["RecordFeedImpressionRequest"];
export type MutualsInterestRequest = components["schemas"]["MutualsInterestRequest"];
export type MutualsInterestResult = components["schemas"]["MutualsInterestResult"];
export type CreateAccessPassIntentRequest = components["schemas"]["CreateAccessPassIntentRequest"];
export type AccessPassIntent = components["schemas"]["AccessPassIntent"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type CreatePaidMessageIntentRequest = components["schemas"]["CreatePaidMessageIntentRequest"];
export type Message = components["schemas"]["Message"];
export type PaidMessageIntent = components["schemas"]["PaidMessageIntent"];
export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];
export type TransactionRequestPostResponse =
  components["schemas"]["TransactionRequestPostResponse"];
export type AcceptPaymentIntentTermsRequest =
  components["schemas"]["AcceptPaymentIntentTermsRequest"];
export type CreateSubscriptionIntentRequest =
  components["schemas"]["CreateSubscriptionIntentRequest"];
export type SubscriptionAuthorizationIntent =
  components["schemas"]["SubscriptionAuthorizationIntent"];
export type SubscriptionAuthorizationTransaction =
  components["schemas"]["SubscriptionAuthorizationTransaction"];
export type SubmitSubscriptionAuthorizationRequest =
  components["schemas"]["SubmitSubscriptionAuthorizationRequest"];
export type Subscription = components["schemas"]["Subscription"];
export type UpsertCreatorMembershipOfferRequest =
  components["schemas"]["UpsertCreatorMembershipOfferRequest"];
export type CreateRefundDisputeRequest = components["schemas"]["CreateRefundDisputeRequest"];
export type RefundDisputeRequest = components["schemas"]["RefundDisputeRequest"];
export type McpOAuthRedirect = { redirectUri: string };
export type McpConnection = {
  id: string;
  clientName: string;
  clientType: string;
  authMode: "scoped_token" | "oauth";
  roleType: "creator" | "admin";
  state: "active" | "revoked" | "expired";
  tokenHint: string | null;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export class ApiMutationError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiMutationError";
  }
}
