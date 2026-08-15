import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type CreatorMediaPage = components["schemas"]["CreatorMediaPage"];
export type CreatorMediaItem = components["schemas"]["CreatorMediaItem"];
export type MediaModerationAppeal = components["schemas"]["MediaModerationAppeal"];
export type SessionState = components["schemas"]["SessionState"];
export type CreatorDashboard = components["schemas"]["CreatorMonetisationDashboard"];
export type CreatorOnboarding = components["schemas"]["CreatorOnboarding"];
export type CreatorProfile = components["schemas"]["CreatorProfile"];
export type LiveRoom = components["schemas"]["LiveRoom"];
export type ActivityItem = components["schemas"]["ActivityItem"];
export type ActivityPage = components["schemas"]["ActivityPage"];
export type WalletTransaction = components["schemas"]["WalletTransaction"];
export type WalletTransactionPage = components["schemas"]["WalletTransactionPage"];
export type Conversation = components["schemas"]["Conversation"];
export type ConversationList = {
  items: Conversation[];
};
export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];
export type Wallet = components["schemas"]["Wallet"];
export type WalletList = {
  items: Wallet[];
};
export type Subscription = components["schemas"]["Subscription"];
export type SubscriptionPage = components["schemas"]["SubscriptionPage"];
export type SubscriptionPlan = components["schemas"]["SubscriptionPlan"];
export type SubscriptionPlanPage = components["schemas"]["SubscriptionPlanPage"];
export type PlatformAccess = components["schemas"]["PlatformAccess"];
export type PlatformPlaybackSession = components["schemas"]["PlatformPlaybackSession"];
export type DiscoverPage = components["schemas"]["DiscoverPage"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedPreferences = components["schemas"]["FeedPreferences"];
export type FollowState = components["schemas"]["FollowState"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type NotificationPushConfig = components["schemas"]["NotificationPushConfig"];
export type AgeStatus = components["schemas"]["AgeStatus"];
export type Event = components["schemas"]["Event"];
export type EventAccessPassPage = components["schemas"]["AccessPassPage"];
export type EventAccessPass = components["schemas"]["AccessPass"];
export type MutualsFeedPage = components["schemas"]["MutualsFeedPage"];
export type MutualsMatchPage = components["schemas"]["MutualsPage"];
export type AiCapabilities = components["schemas"]["AiCapabilities"];
export type OrganizationDashboardPage = components["schemas"]["OrganizationDashboardPage"];
export type VerificationStatus = {
  capabilities: Record<string, boolean>;
  missingRequirements: string[];
  nextBestAction: string;
  verificationSummary: {
    ageAccess: VerificationRecordSummary | null;
    adultPublisherEligibility: VerificationRecordSummary | null;
    creatorKyc: VerificationRecordSummary | null;
    orgKyb: VerificationRecordSummary | null;
  };
};
export type VerificationRecordSummary = {
  subjectType: string;
  subjectId: string;
  purpose: string;
  status: string;
  provider: string;
  method: string;
  assuranceLevel: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  reusable: boolean;
};
export type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
export type AdminNotificationHealth = components["schemas"]["AdminNotificationHealth"];
export type AdminMutualsSafety = components["schemas"]["AdminMutualsSafety"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AdminContentItem = components["schemas"]["AdminContentItem"];
export type AdminModerationActionRequest = components["schemas"]["AdminModerationActionRequest"];
export type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
export type AdminUnlock = components["schemas"]["AdminUnlock"];
export type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];
export type AdminLiveRoom = components["schemas"]["AdminLiveRoom"];
export type AdminMediaAsset = components["schemas"]["AdminMediaAsset"];
export type AdminAgeCheck = components["schemas"]["AdminAgeCheck"];
export type AdminIdentityCheck = components["schemas"]["AdminIdentityCheck"];
export type AdminAiSession = components["schemas"]["AdminAiSession"];
export type AdminAiToolCall = components["schemas"]["AdminAiToolCall"];
export type AdminReport = components["schemas"]["AdminReport"];
export type AdminUser = components["schemas"]["AdminUser"];
export type AdminSupportCase = components["schemas"]["AdminSupportCase"];
export type AdminSupportPolicy = components["schemas"]["AdminSupportPolicy"];
export type AdminRefundDispute = components["schemas"]["AdminRefundDispute"];
export type AdminDataRequest = components["schemas"]["AdminDataRequest"];
export type AdminComplianceLedgerEntry = components["schemas"]["AdminComplianceLedgerEntry"];
export type AdminComplianceReport = components["schemas"]["AdminComplianceReport"];
export type AdminVatDetermination = components["schemas"]["AdminVatDetermination"];
export type AdminReceipt = components["schemas"]["AdminReceipt"];
export type AdminInvoice = components["schemas"]["AdminInvoice"];
export type AdminReferralProgram = components["schemas"]["AdminReferralProgram"];
export type AdminPartnerCampaign = components["schemas"]["AdminPartnerCampaign"];
export type AdminTierWaiver = components["schemas"]["AdminTierWaiver"];
export type AdminOrganization = components["schemas"]["AdminOrganization"];
export type AdminOrganizationMember = components["schemas"]["AdminOrganizationMember"];
export type AdminFeatureFlag = components["schemas"]["AdminFeatureFlag"];
export type AdminOrganizationKybActionRequest = components["schemas"]["AdminOrganizationKybActionRequest"];
export type AdminOrganizationMemberActionRequest = components["schemas"]["AdminOrganizationMemberActionRequest"];
export type AdminSupportPolicyActionRequest = components["schemas"]["AdminSupportPolicyActionRequest"];
export type PerformerConsentRequest = components["schemas"]["PerformerConsentRequest"];
export type AdminFeatureFlagPatchRequest = components["schemas"]["AdminFeatureFlagPatchRequest"];
export type AdminSupportCaseActionRequest = components["schemas"]["AdminSupportCaseActionRequest"];
export type AdminRefundDisputeActionRequest = components["schemas"]["AdminRefundDisputeActionRequest"];
export type AdminDataRequestActionRequest = components["schemas"]["AdminDataRequestActionRequest"];
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
export type McpConnectionPage = {
  items: McpConnection[];
  nextCursor: string | null;
};
export type McpConsentRequest = {
  id: string;
  clientName: string;
  clientType: string;
  roleType: "creator" | "admin";
  resource: string;
  requestedScopes: string[];
  status: string;
  expiresAt: string;
  createdAt: string;
};

export type AdminPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };
