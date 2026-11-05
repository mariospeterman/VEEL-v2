import { getJson, postJson } from "./api-client-transport";
import type {
  AiCapabilities,
  AdminAgeCheck,
  AdminCurrentStaff,
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
  AnalyticsProjectionHealth,
  AnalyticsQueryRequest,
  AnalyticsQueryResponse,
  AdminPage,
  AdminPartnerCampaign,
  AdminPaymentIntent,
  AdminPaymentCommercialPolicy,
  AdminProviderEvent,
  AdminReceipt,
  AdminReferralProgram,
  AdminRefundDispute,
  AdminReport,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminStaffDirectory,
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
  DiscoverCursorSet,
  Event,
  EventAccessPass,
  EventAccessPassPage,
  FeedPage,
  FeedPreferences,
  FollowState,
  LiveRoom,
  LiveRoomPage,
  LiveChatPage,
  McpConnectionPage,
  McpToolList,
  McpConsentRequest,
  MessagePage,
  MutualsFeedPage,
  MutualsMatchPage,
  NotificationPreferences,
  NotificationPage,
  NotificationPushConfig,
  OrganizationDashboardPage,
  OrganizationMember,
  ManagedCreatorRelationship,
  ManagedCreatorReporting,
  PlatformAccess,
  PrivacySettings,
  PerformerConsentRequest,
  SessionState,
  SubscriptionPage,
  SubscriptionPlan,
  SubscriptionPlanPage,
  VerificationStatus,
  WalletList,
  WalletTransactionPage
} from "./api-client-types";
import { adminApiPagePath } from "./admin/admin-pagination";

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

export async function getMyLiveRooms(cursor?: string): Promise<ApiResult<LiveRoomPage>> {
  return getJson<LiveRoomPage>(withCursor("/v1/live/rooms/mine", cursor));
}

export async function getLiveRoomMessages(liveRoomId: string): Promise<ApiResult<LiveChatPage>> {
  return getJson<LiveChatPage>(`/v1/live/rooms/${encodeURIComponent(liveRoomId)}/messages`);
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

export async function getConversations(cursor?: string): Promise<ApiResult<ConversationList>> {
  return getJson<ConversationList>(withCursor("/v1/messages/conversations", cursor));
}

export async function getConversationMessages(
  conversationId: string,
  cursor?: string
): Promise<ApiResult<MessagePage>> {
  return getJson<MessagePage>(
    withCursor(
      `/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
      cursor
    )
  );
}

function withCursor(path: string, cursor: string | undefined): string {
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export async function getWallets(): Promise<ApiResult<WalletList>> {
  return getJson<WalletList>("/v1/wallets");
}

export async function getSubscriptionPlans(cursor?: string): Promise<ApiResult<SubscriptionPlanPage>> {
  return getJson<SubscriptionPlanPage>(withCursor("/v1/subscriptions/plans", cursor));
}

export async function getSubscriptions(options: {
  cursor?: string;
  scope?: "platform" | "creator";
  view?: "active" | "history";
} = {}): Promise<ApiResult<SubscriptionPage>> {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.scope) query.set("scope", options.scope);
  if (options.view) query.set("view", options.view);
  return getJson<SubscriptionPage>(
    `/v1/subscriptions${query.size > 0 ? `?${query.toString()}` : ""}`
  );
}

export async function getMyCreatorMembershipOffer(): Promise<ApiResult<SubscriptionPlan>> {
  return getJson<SubscriptionPlan>("/v1/subscriptions/creator-offer");
}

export async function getPlatformAccess(): Promise<ApiResult<PlatformAccess>> {
  return getJson<PlatformAccess>("/v1/platform-access");
}

export async function getDiscoverSearch(
  query = "",
  cursors: Partial<DiscoverCursorSet> = {}
): Promise<ApiResult<DiscoverPage>> {
  const search = new URLSearchParams();

  if (query) {
    search.set("q", query);
  }

  const cursorParameters = [
    ["contentCursor", cursors.content],
    ["creatorCursor", cursors.creators],
    ["hashtagCursor", cursors.hashtags],
    ["eventCursor", cursors.events],
    ["liveCursor", cursors.liveRooms]
  ] as const;
  for (const [parameter, cursor] of cursorParameters) {
    if (cursor) search.set(parameter, cursor);
  }

  return getJson<DiscoverPage>(`/v1/discover/search${search.size > 0 ? `?${search.toString()}` : ""}`);
}

export async function getHomeFeed(
  mode: "latest" | "following" = "latest",
  surface: "home" | "bits" | "moments" = "home",
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

export async function getPrivacySettings(): Promise<ApiResult<PrivacySettings>> {
  return getJson<PrivacySettings>("/v1/privacy");
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

export async function getMcpTools(): Promise<ApiResult<McpToolList>> {
  return getJson<McpToolList>("/v1/mcp/tools");
}

export async function getMcpConsentRequest(requestId: string): Promise<ApiResult<McpConsentRequest>> {
  return getJson<McpConsentRequest>(`/oauth/consent/${encodeURIComponent(requestId)}`);
}

export async function getOrganizationDashboards(): Promise<ApiResult<OrganizationDashboardPage>> {
  return getJson<OrganizationDashboardPage>("/v1/organizations");
}

export async function getOrganizationMembers(
  organizationId: string
): Promise<ApiResult<{ items: OrganizationMember[] }>> {
  return getJson<{ items: OrganizationMember[] }>(
    `/v1/organizations/${encodeURIComponent(organizationId)}/members`
  );
}

export async function getManagedCreatorRelationships(): Promise<ApiResult<{ items: ManagedCreatorRelationship[] }>> {
  return getJson<{ items: ManagedCreatorRelationship[] }>("/v1/managed-creator-relationships");
}

export async function getManagedCreatorReporting(
  relationshipId: string
): Promise<ApiResult<ManagedCreatorReporting>> {
  return getJson<ManagedCreatorReporting>(
    `/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/reporting`
  );
}

export async function getVerificationStatus(): Promise<ApiResult<VerificationStatus>> {
  return getJson<VerificationStatus>("/v1/verification/status");
}

export async function getAdminOpsSummary(): Promise<ApiResult<AdminOpsSummary>> {
  return getJson<AdminOpsSummary>("/v1/admin/ops/summary");
}

export async function getAdminCurrentStaff(): Promise<ApiResult<AdminCurrentStaff>> {
  return getJson<AdminCurrentStaff>("/v1/admin/me");
}

export async function getAdminStaffDirectory(): Promise<ApiResult<AdminStaffDirectory>> {
  return getJson<AdminStaffDirectory>("/v1/admin/staff");
}

export async function getAdminAnalyticsHealth(): Promise<ApiResult<AnalyticsProjectionHealth>> {
  return getJson<AnalyticsProjectionHealth>("/v1/admin/analytics/health");
}

export async function queryAnalytics(body: AnalyticsQueryRequest): Promise<ApiResult<AnalyticsQueryResponse>> {
  return postJson<AnalyticsQueryResponse>("/v1/analytics/query", body, `analytics-query-${crypto.randomUUID()}`);
}

export async function getAdminNotificationHealth(): Promise<ApiResult<AdminNotificationHealth>> {
  return getJson<AdminNotificationHealth>("/v1/admin/notifications/health");
}

export async function getAdminUsers(cursor?: string): Promise<ApiResult<AdminPage<AdminUser>>> {
  return getAdminPage<AdminUser>("/v1/admin/users", cursor);
}

export async function getAdminContent(cursor?: string): Promise<ApiResult<AdminPage<AdminContentItem>>> {
  return getAdminPage<AdminContentItem>("/v1/admin/content", cursor);
}

export async function getAdminReports(cursor?: string): Promise<ApiResult<AdminPage<AdminReport>>> {
  return getAdminPage<AdminReport>("/v1/admin/reports", cursor);
}

export async function getAdminPaymentIntents(cursor?: string): Promise<ApiResult<AdminPage<AdminPaymentIntent>>> {
  return getAdminPage<AdminPaymentIntent>("/v1/admin/payments/intents", cursor);
}

export async function getAdminPaymentCommercialPolicies(cursor?: string): Promise<ApiResult<AdminPage<AdminPaymentCommercialPolicy>>> {
  return getAdminPage<AdminPaymentCommercialPolicy>("/v1/admin/payments/commercial-policies", cursor);
}

export async function getAdminUnlocks(cursor?: string): Promise<ApiResult<AdminPage<AdminUnlock>>> {
  return getAdminPage<AdminUnlock>("/v1/admin/unlocks", cursor);
}

export async function getAdminProviderEvents(cursor?: string): Promise<ApiResult<AdminPage<AdminProviderEvent>>> {
  return getAdminPage<AdminProviderEvent>("/v1/admin/provider-events", cursor);
}

export async function getAdminLiveRooms(cursor?: string): Promise<ApiResult<AdminPage<AdminLiveRoom>>> {
  return getAdminPage<AdminLiveRoom>("/v1/admin/live/rooms", cursor);
}

export async function getAdminMediaAssets(cursor?: string): Promise<ApiResult<AdminPage<AdminMediaAsset>>> {
  return getAdminPage<AdminMediaAsset>("/v1/admin/media/assets", cursor);
}

export async function getAdminAgeChecks(cursor?: string): Promise<ApiResult<AdminPage<AdminAgeCheck>>> {
  return getAdminPage<AdminAgeCheck>("/v1/admin/age-kyc/age-checks", cursor);
}

export async function getAdminIdentityChecks(cursor?: string): Promise<ApiResult<AdminPage<AdminIdentityCheck>>> {
  return getAdminPage<AdminIdentityCheck>("/v1/admin/age-kyc/identity-checks", cursor);
}

export async function getAdminAiSessions(cursor?: string): Promise<ApiResult<AdminPage<AdminAiSession>>> {
  return getAdminPage<AdminAiSession>("/v1/admin/ai/sessions", cursor);
}

export async function getAdminAiToolCalls(cursor?: string): Promise<ApiResult<AdminPage<AdminAiToolCall>>> {
  return getAdminPage<AdminAiToolCall>("/v1/admin/ai/tool-calls", cursor);
}

export async function getAdminAuditEvents(cursor?: string): Promise<ApiResult<AdminPage<AuditEvent>>> {
  return getAdminPage<AuditEvent>("/v1/admin/audit", cursor);
}

export async function getAdminSupportCases(cursor?: string): Promise<ApiResult<AdminPage<AdminSupportCase>>> {
  return getAdminPage<AdminSupportCase>("/v1/admin/support/cases", cursor);
}

export async function getAdminSupportPolicies(cursor?: string): Promise<ApiResult<AdminPage<AdminSupportPolicy>>> {
  return getAdminPage<AdminSupportPolicy>("/v1/admin/support/policies", cursor);
}

export async function getAdminRefundDisputes(cursor?: string): Promise<ApiResult<AdminPage<AdminRefundDispute>>> {
  return getAdminPage<AdminRefundDispute>("/v1/admin/refunds/disputes", cursor);
}

export async function getAdminDataRequests(cursor?: string): Promise<ApiResult<AdminPage<AdminDataRequest>>> {
  return getAdminPage<AdminDataRequest>("/v1/admin/data-requests", cursor);
}

export async function getAdminEvents(cursor?: string): Promise<ApiResult<AdminPage<Event>>> {
  return getAdminPage<Event>("/v1/admin/events", cursor);
}

export async function getAdminEventAccessPasses(cursor?: string): Promise<ApiResult<AdminPage<EventAccessPass>>> {
  return getAdminPage<EventAccessPass>("/v1/admin/event-access-passes", cursor);
}

export async function getAdminMutualsSafety(): Promise<ApiResult<AdminMutualsSafety>> {
  return getJson<AdminMutualsSafety>("/v1/admin/mutuals/safety");
}

export async function getAdminComplianceLedger(cursor?: string): Promise<ApiResult<AdminPage<AdminComplianceLedgerEntry>>> {
  return getAdminPage<AdminComplianceLedgerEntry>("/v1/admin/compliance/ledger", cursor);
}

export async function getAdminDac7Reports(cursor?: string): Promise<ApiResult<AdminPage<AdminComplianceReport>>> {
  return getAdminPage<AdminComplianceReport>("/v1/admin/compliance/dac7/reports", cursor);
}

export async function getAdminCarfReports(cursor?: string): Promise<ApiResult<AdminPage<AdminComplianceReport>>> {
  return getAdminPage<AdminComplianceReport>("/v1/admin/compliance/carf/reports", cursor);
}

export async function getAdminVatDeterminations(cursor?: string): Promise<ApiResult<AdminPage<AdminVatDetermination>>> {
  return getAdminPage<AdminVatDetermination>("/v1/admin/compliance/vat/determinations", cursor);
}

export async function getAdminReceipts(cursor?: string): Promise<ApiResult<AdminPage<AdminReceipt>>> {
  return getAdminPage<AdminReceipt>("/v1/admin/compliance/receipts", cursor);
}

export async function getAdminInvoices(cursor?: string): Promise<ApiResult<AdminPage<AdminInvoice>>> {
  return getAdminPage<AdminInvoice>("/v1/admin/compliance/invoices", cursor);
}

export async function getAdminReferralPrograms(cursor?: string): Promise<ApiResult<AdminPage<AdminReferralProgram>>> {
  return getAdminPage<AdminReferralProgram>("/v1/admin/referrals/programs", cursor);
}

export async function getAdminPartnerCampaigns(cursor?: string): Promise<ApiResult<AdminPage<AdminPartnerCampaign>>> {
  return getAdminPage<AdminPartnerCampaign>("/v1/admin/referrals/partner-campaigns", cursor);
}

export async function getAdminTierWaivers(cursor?: string): Promise<ApiResult<AdminPage<AdminTierWaiver>>> {
  return getAdminPage<AdminTierWaiver>("/v1/admin/tier-waivers", cursor);
}

export async function getAdminOrganizations(cursor?: string): Promise<ApiResult<AdminPage<AdminOrganization>>> {
  return getAdminPage<AdminOrganization>("/v1/admin/organizations", cursor);
}

export async function getAdminOrganizationMembers(
  organizationId: string,
  cursor?: string
): Promise<ApiResult<AdminPage<AdminOrganizationMember>>> {
  return getAdminPage<AdminOrganizationMember>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members`,
    cursor
  );
}

export async function getAdminFeatureFlags(cursor?: string): Promise<ApiResult<AdminPage<AdminFeatureFlag>>> {
  return getAdminPage<AdminFeatureFlag>("/v1/admin/feature-flags", cursor);
}

function getAdminPage<T>(path: string, cursor?: string): Promise<ApiResult<AdminPage<T>>> {
  return getJson<AdminPage<T>>(adminApiPagePath(path, cursor));
}

export async function getPerformerInvitation(token: string): Promise<ApiResult<PerformerConsentRequest>> {
  return getJson<PerformerConsentRequest>(`/v1/performer-invitations/${encodeURIComponent(token)}`);
}
