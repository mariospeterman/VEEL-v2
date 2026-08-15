import type { components } from "@veel/contracts";

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
export type CreateWalletAuthChallengeRequest =
  components["schemas"]["CreateWalletAuthChallengeRequest"];
export type CreateWalletAuthSessionRequest =
  components["schemas"]["CreateWalletAuthSessionRequest"];
export type WalletAuthChallenge = components["schemas"]["WalletAuthChallenge"];
export type WalletAuthSession = components["schemas"]["WalletAuthSession"];
export type ApplicationSessionExpiry = components["schemas"]["ApplicationSessionExpiry"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];
export type Wallet = components["schemas"]["Wallet"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type UpdateContentRequest = components["schemas"]["UpdateContentRequest"];
export type PublishContentRequest = components["schemas"]["PublishContentRequest"];
export type ContentItem = components["schemas"]["ContentItem"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type UploadSession = components["schemas"]["UploadSession"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
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
export type BlockState = components["schemas"]["BlockState"];
export type CreateAccessPassIntentRequest = components["schemas"]["CreateAccessPassIntentRequest"];
export type AccessPassIntent = components["schemas"]["AccessPassIntent"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type CreatePaidMessageIntentRequest = components["schemas"]["CreatePaidMessageIntentRequest"];
export type Message = components["schemas"]["Message"];
export type PaidMessageIntent = components["schemas"]["PaidMessageIntent"];
export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];
export type CreateSubscriptionIntentRequest =
  components["schemas"]["CreateSubscriptionIntentRequest"];
export type SubscriptionAuthorizationIntent =
  components["schemas"]["SubscriptionAuthorizationIntent"];
export type SubmitSubscriptionAuthorizationRequest =
  components["schemas"]["SubmitSubscriptionAuthorizationRequest"];
export type Subscription = components["schemas"]["Subscription"];
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
