import { getJson } from "./api-client-transport";
import type {
  AiCapabilities,
  AdminAgeCheck,
  AdminAiSession,
  AdminAiToolCall,
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminContentItem,
  AdminDataRequest,
  AdminFeatureFlag,
  AdminInvoice,
  AdminIdentityCheck,
  AdminLiveRoom,
  AdminMediaAsset,
  AdminMutualsSafety,
  AdminNotificationHealth,
  AdminOrganization,
  AdminOrganizationMember,
  AdminOpsSummary,
  AdminPage,
  AdminPartnerCampaign,
  AdminPaymentIntent,
  AdminProviderEvent,
  AdminReceipt,
  AdminReferralProgram,
  AdminRefundDispute,
  AdminReport,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminTierWaiver,
  AdminUnlock,
  AdminUser,
  AdminVatDetermination,
  ActivityPage,
  AgeStatus,
  ApiResult,
  AuditEvent,
  ContentItem,
  ConversationList,
  CreatorDashboard,
  CreatorMediaPage,
  CreatorOnboarding,
  CreatorProfile,
  DiscoverPage,
  Event,
  EventAccessPass,
  EventAccessPassPage,
  FeedPage,
  FeedPreferences,
  FollowState,
  LiveRoom,
  McpConnectionPage,
  McpConsentRequest,
  MessagePage,
  MutualsFeedPage,
  MutualsMatchPage,
  NotificationPreferences,
  NotificationPage,
  NotificationPushConfig,
  OrganizationDashboardPage,
  PlatformAccess,
  PerformerConsentRequest,
  SessionState,
  SubscriptionPage,
  SubscriptionPlanPage,
  VerificationStatus,
  WalletList,
  WalletTransactionPage
} from "./api-client-types";

export async function getContentItem(contentId: string): Promise<ApiResult<ContentItem>> {
  return getJson<ContentItem>(`/v1/content/${encodeURIComponent(contentId)}`);
}

export async function getMyContent(): Promise<ApiResult<CreatorMediaPage>> {
  return getJson<CreatorMediaPage>("/v1/content/mine");
}

export async function getSession(): Promise<ApiResult<SessionState>> {
  return getJson<SessionState>("/v1/session");
}

export async function getLiveRoom(liveRoomId: string): Promise<ApiResult<LiveRoom>> {
  return getJson<LiveRoom>(`/v1/live/rooms/${encodeURIComponent(liveRoomId)}`);
}

export async function getCreatorProfile(handle: string): Promise<ApiResult<CreatorProfile>> {
  return getJson<CreatorProfile>(`/v1/profiles/${encodeURIComponent(handle)}`);
}

export async function getMyCreatorDashboard(): Promise<ApiResult<CreatorDashboard>> {
  return getJson<CreatorDashboard>("/v1/profiles/me/creator-dashboard");
}

export async function getMyCreatorOnboarding(): Promise<ApiResult<CreatorOnboarding>> {
  return getJson<CreatorOnboarding>("/v1/profiles/me/creator-onboarding");
}

export async function getPaymentActivity(): Promise<ApiResult<ActivityPage>> {
  return getJson<ActivityPage>("/v1/activity/payments");
}

export async function getWalletTransactionActivity(): Promise<ApiResult<WalletTransactionPage>> {
  return getJson<WalletTransactionPage>("/v1/activity/wallet-transactions");
}

export async function getConversations(): Promise<ApiResult<ConversationList>> {
  return getJson<ConversationList>("/v1/messages/conversations");
}

export async function getConversationMessages(conversationId: string): Promise<ApiResult<MessagePage>> {
  return getJson<MessagePage>(`/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export async function getWallets(): Promise<ApiResult<WalletList>> {
  return getJson<WalletList>("/v1/wallets");
}

export async function getSubscriptionPlans(): Promise<ApiResult<SubscriptionPlanPage>> {
  return getJson<SubscriptionPlanPage>("/v1/subscriptions/plans");
}

export async function getSubscriptions(): Promise<ApiResult<SubscriptionPage>> {
  return getJson<SubscriptionPage>("/v1/subscriptions");
}

export async function getPlatformAccess(): Promise<ApiResult<PlatformAccess>> {
  return getJson<PlatformAccess>("/v1/platform-access");
}

export async function getDiscoverSearch(query = ""): Promise<ApiResult<DiscoverPage>> {
  const search = new URLSearchParams();

  if (query) {
    search.set("q", query);
  }

  return getJson<DiscoverPage>(`/v1/discover/search${search.size > 0 ? `?${search.toString()}` : ""}`);
}

export async function getHomeFeed(
  mode = "recommended",
  surface: "home" | "bits" = "home",
  cursor?: string
): Promise<ApiResult<FeedPage>> {
  const query = new URLSearchParams({ mode, surface });
  if (cursor) query.set("cursor", cursor);
  return getJson<FeedPage>(`/v1/content/feed?${query.toString()}`);
}

export async function getFollowState(userId: string): Promise<ApiResult<FollowState>> {
  return getJson<FollowState>(`/v1/follows/${encodeURIComponent(userId)}`);
}

export async function getFeedPreferences(): Promise<ApiResult<FeedPreferences>> {
  return getJson<FeedPreferences>("/v1/feed/preferences");
}

export async function getNotificationPreferences(): Promise<ApiResult<NotificationPreferences>> {
  return getJson<NotificationPreferences>("/v1/notifications/preferences");
}

export async function getNotifications(cursor?: string): Promise<ApiResult<NotificationPage>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson<NotificationPage>(`/v1/notifications${query}`);
}

export async function getNotificationPushConfig(): Promise<ApiResult<NotificationPushConfig>> {
  return getJson<NotificationPushConfig>("/v1/notifications/push-config");
}

export async function getAgeStatus(): Promise<ApiResult<AgeStatus>> {
  return getJson<AgeStatus>("/v1/age/status");
}

export async function getEvent(eventId: string): Promise<ApiResult<Event>> {
  return getJson<Event>(`/v1/events/${encodeURIComponent(eventId)}`);
}

export async function getEventAccessPassActivity(): Promise<ApiResult<EventAccessPassPage>> {
  return getJson<EventAccessPassPage>("/v1/activity/access-passes");
}

export async function getMutualsFeed(): Promise<ApiResult<MutualsFeedPage>> {
  return getJson<MutualsFeedPage>("/v1/mutuals/feed");
}

export async function getMutualsMatches(): Promise<ApiResult<MutualsMatchPage>> {
  return getJson<MutualsMatchPage>("/v1/mutuals");
}

export async function getAiCapabilities(): Promise<ApiResult<AiCapabilities>> {
  return getJson<AiCapabilities>("/v1/ai/capabilities");
}

export async function getMcpConnections(): Promise<ApiResult<McpConnectionPage>> {
  return getJson<McpConnectionPage>("/v1/mcp/connections");
}

export async function getMcpConsentRequest(requestId: string): Promise<ApiResult<McpConsentRequest>> {
  return getJson<McpConsentRequest>(`/oauth/consent/${encodeURIComponent(requestId)}`);
}

export async function getOrganizationDashboards(): Promise<ApiResult<OrganizationDashboardPage>> {
  return getJson<OrganizationDashboardPage>("/v1/organizations");
}

export async function getVerificationStatus(): Promise<ApiResult<VerificationStatus>> {
  return getJson<VerificationStatus>("/v1/verification/status");
}

export async function getAdminOpsSummary(): Promise<ApiResult<AdminOpsSummary>> {
  return getJson<AdminOpsSummary>("/v1/admin/ops/summary");
}

export async function getAdminNotificationHealth(): Promise<ApiResult<AdminNotificationHealth>> {
  return getJson<AdminNotificationHealth>("/v1/admin/notifications/health");
}

export async function getAdminUsers(): Promise<ApiResult<AdminPage<AdminUser>>> {
  return getJson<AdminPage<AdminUser>>("/v1/admin/users");
}

export async function getAdminContent(): Promise<ApiResult<AdminPage<AdminContentItem>>> {
  return getJson<AdminPage<AdminContentItem>>("/v1/admin/content");
}

export async function getAdminReports(): Promise<ApiResult<AdminPage<AdminReport>>> {
  return getJson<AdminPage<AdminReport>>("/v1/admin/reports");
}

export async function getAdminPaymentIntents(): Promise<ApiResult<AdminPage<AdminPaymentIntent>>> {
  return getJson<AdminPage<AdminPaymentIntent>>("/v1/admin/payments/intents");
}

export async function getAdminUnlocks(): Promise<ApiResult<AdminPage<AdminUnlock>>> {
  return getJson<AdminPage<AdminUnlock>>("/v1/admin/unlocks");
}

export async function getAdminProviderEvents(): Promise<ApiResult<AdminPage<AdminProviderEvent>>> {
  return getJson<AdminPage<AdminProviderEvent>>("/v1/admin/provider-events");
}

export async function getAdminLiveRooms(): Promise<ApiResult<AdminPage<AdminLiveRoom>>> {
  return getJson<AdminPage<AdminLiveRoom>>("/v1/admin/live/rooms");
}

export async function getAdminMediaAssets(): Promise<ApiResult<AdminPage<AdminMediaAsset>>> {
  return getJson<AdminPage<AdminMediaAsset>>("/v1/admin/media/assets");
}

export async function getAdminAgeChecks(): Promise<ApiResult<AdminPage<AdminAgeCheck>>> {
  return getJson<AdminPage<AdminAgeCheck>>("/v1/admin/age-kyc/age-checks");
}

export async function getAdminIdentityChecks(): Promise<ApiResult<AdminPage<AdminIdentityCheck>>> {
  return getJson<AdminPage<AdminIdentityCheck>>("/v1/admin/age-kyc/identity-checks");
}

export async function getAdminAiSessions(): Promise<ApiResult<AdminPage<AdminAiSession>>> {
  return getJson<AdminPage<AdminAiSession>>("/v1/admin/ai/sessions");
}

export async function getAdminAiToolCalls(): Promise<ApiResult<AdminPage<AdminAiToolCall>>> {
  return getJson<AdminPage<AdminAiToolCall>>("/v1/admin/ai/tool-calls");
}

export async function getAdminAuditEvents(): Promise<ApiResult<AdminPage<AuditEvent>>> {
  return getJson<AdminPage<AuditEvent>>("/v1/admin/audit");
}

export async function getAdminSupportCases(): Promise<ApiResult<AdminPage<AdminSupportCase>>> {
  return getJson<AdminPage<AdminSupportCase>>("/v1/admin/support/cases");
}

export async function getAdminSupportPolicies(): Promise<ApiResult<AdminPage<AdminSupportPolicy>>> {
  return getJson<AdminPage<AdminSupportPolicy>>("/v1/admin/support/policies");
}

export async function getAdminRefundDisputes(): Promise<ApiResult<AdminPage<AdminRefundDispute>>> {
  return getJson<AdminPage<AdminRefundDispute>>("/v1/admin/refunds/disputes");
}

export async function getAdminDataRequests(): Promise<ApiResult<AdminPage<AdminDataRequest>>> {
  return getJson<AdminPage<AdminDataRequest>>("/v1/admin/data-requests");
}

export async function getAdminEvents(): Promise<ApiResult<AdminPage<Event>>> {
  return getJson<AdminPage<Event>>("/v1/admin/events");
}

export async function getAdminEventAccessPasses(): Promise<ApiResult<AdminPage<EventAccessPass>>> {
  return getJson<AdminPage<EventAccessPass>>("/v1/admin/event-access-passes");
}

export async function getAdminMutualsSafety(): Promise<ApiResult<AdminMutualsSafety>> {
  return getJson<AdminMutualsSafety>("/v1/admin/mutuals/safety");
}

export async function getAdminComplianceLedger(): Promise<ApiResult<AdminPage<AdminComplianceLedgerEntry>>> {
  return getJson<AdminPage<AdminComplianceLedgerEntry>>("/v1/admin/compliance/ledger");
}

export async function getAdminDac7Reports(): Promise<ApiResult<AdminPage<AdminComplianceReport>>> {
  return getJson<AdminPage<AdminComplianceReport>>("/v1/admin/compliance/dac7/reports");
}

export async function getAdminCarfReports(): Promise<ApiResult<AdminPage<AdminComplianceReport>>> {
  return getJson<AdminPage<AdminComplianceReport>>("/v1/admin/compliance/carf/reports");
}

export async function getAdminVatDeterminations(): Promise<ApiResult<AdminPage<AdminVatDetermination>>> {
  return getJson<AdminPage<AdminVatDetermination>>("/v1/admin/compliance/vat/determinations");
}

export async function getAdminReceipts(): Promise<ApiResult<AdminPage<AdminReceipt>>> {
  return getJson<AdminPage<AdminReceipt>>("/v1/admin/compliance/receipts");
}

export async function getAdminInvoices(): Promise<ApiResult<AdminPage<AdminInvoice>>> {
  return getJson<AdminPage<AdminInvoice>>("/v1/admin/compliance/invoices");
}

export async function getAdminReferralPrograms(): Promise<ApiResult<AdminPage<AdminReferralProgram>>> {
  return getJson<AdminPage<AdminReferralProgram>>("/v1/admin/referrals/programs");
}

export async function getAdminPartnerCampaigns(): Promise<ApiResult<AdminPage<AdminPartnerCampaign>>> {
  return getJson<AdminPage<AdminPartnerCampaign>>("/v1/admin/referrals/partner-campaigns");
}

export async function getAdminTierWaivers(): Promise<ApiResult<AdminPage<AdminTierWaiver>>> {
  return getJson<AdminPage<AdminTierWaiver>>("/v1/admin/tier-waivers");
}

export async function getAdminOrganizations(): Promise<ApiResult<AdminPage<AdminOrganization>>> {
  return getJson<AdminPage<AdminOrganization>>("/v1/admin/organizations");
}

export async function getAdminOrganizationMembers(
  organizationId: string
): Promise<ApiResult<AdminPage<AdminOrganizationMember>>> {
  return getJson<AdminPage<AdminOrganizationMember>>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members`
  );
}

export async function getAdminFeatureFlags(): Promise<ApiResult<AdminPage<AdminFeatureFlag>>> {
  return getJson<AdminPage<AdminFeatureFlag>>("/v1/admin/feature-flags");
}

export async function getPerformerInvitation(token: string): Promise<ApiResult<PerformerConsentRequest>> {
  return getJson<PerformerConsentRequest>(`/v1/performer-invitations/${encodeURIComponent(token)}`);
}
