import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parsePublicWebEnv } from "@veel/config";
import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
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
export type DiscoverPage = components["schemas"]["DiscoverPage"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedPreferences = components["schemas"]["FeedPreferences"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type NotificationPushConfig = components["schemas"]["NotificationPushConfig"];
export type AgeStatus = components["schemas"]["AgeStatus"];
export type Event = components["schemas"]["Event"];
export type EventAccessPassPage = components["schemas"]["TicketPage"];
export type EventAccessPass = components["schemas"]["Ticket"];
export type MutualsFeedPage = components["schemas"]["DatingFeedPage"];
export type MutualsMatchPage = components["schemas"]["DatingMatchPage"];
export type AiCapabilities = components["schemas"]["AiCapabilities"];
export type OrganizationDashboardPage = components["schemas"]["OrganizationDashboardPage"];
export type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
export type AdminNotificationHealth = components["schemas"]["AdminNotificationHealth"];
export type AdminMutualsSafety = components["schemas"]["AdminMutualsSafety"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AdminContentItem = components["schemas"]["AdminContentItem"];
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
export type AdminFeatureFlagPatchRequest = components["schemas"]["AdminFeatureFlagPatchRequest"];
export type AdminSupportCaseActionRequest = components["schemas"]["AdminSupportCaseActionRequest"];
export type AdminRefundDisputeActionRequest = components["schemas"]["AdminRefundDisputeActionRequest"];
export type AdminDataRequestActionRequest = components["schemas"]["AdminDataRequestActionRequest"];

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

export async function getContentItem(contentId: string): Promise<ApiResult<ContentItem>> {
  return getJson<ContentItem>(`/v1/content/${encodeURIComponent(contentId)}`);
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

export async function getDiscoverSearch(query = ""): Promise<ApiResult<DiscoverPage>> {
  const search = new URLSearchParams();

  if (query) {
    search.set("q", query);
  }

  return getJson<DiscoverPage>(`/v1/discover/search${search.size > 0 ? `?${search.toString()}` : ""}`);
}

export async function getHomeFeed(mode = "recommended"): Promise<ApiResult<FeedPage>> {
  return getJson<FeedPage>(`/v1/content/feed?mode=${encodeURIComponent(mode)}`);
}

export async function getFeedPreferences(): Promise<ApiResult<FeedPreferences>> {
  return getJson<FeedPreferences>("/v1/feed/preferences");
}

export async function getNotificationPreferences(): Promise<ApiResult<NotificationPreferences>> {
  return getJson<NotificationPreferences>("/v1/notifications/preferences");
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
  return getJson<EventAccessPassPage>("/v1/activity/tickets");
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

export async function getOrganizationDashboards(): Promise<ApiResult<OrganizationDashboardPage>> {
  return getJson<OrganizationDashboardPage>("/v1/organizations");
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

export async function getAdminTickets(): Promise<ApiResult<AdminPage<EventAccessPass>>> {
  return getJson<AdminPage<EventAccessPass>>("/v1/admin/tickets");
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

export async function updateAdminOrganizationKyb(
  organizationId: string,
  body: AdminOrganizationKybActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminOrganization>> {
  return patchJson<AdminOrganization>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/kyb`,
    body,
    idempotencyKey
  );
}

export async function updateAdminOrganizationMember(
  organizationId: string,
  membershipId: string,
  body: AdminOrganizationMemberActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminOrganizationMember>> {
  return patchJson<AdminOrganizationMember>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminSupportPolicy(
  supportPolicyId: string,
  body: AdminSupportPolicyActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminSupportPolicy>> {
  return patchJson<AdminSupportPolicy>(
    `/v1/admin/support/policies/${encodeURIComponent(supportPolicyId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminSupportCase(
  supportCaseId: string,
  body: AdminSupportCaseActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminSupportCase>> {
  return patchJson<AdminSupportCase>(
    `/v1/admin/support/cases/${encodeURIComponent(supportCaseId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminRefundDispute(
  refundDisputeId: string,
  body: AdminRefundDisputeActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminRefundDispute>> {
  return patchJson<AdminRefundDispute>(
    `/v1/admin/refunds/disputes/${encodeURIComponent(refundDisputeId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminDataRequest(
  dataRequestId: string,
  body: AdminDataRequestActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminDataRequest>> {
  return patchJson<AdminDataRequest>(
    `/v1/admin/data-requests/${encodeURIComponent(dataRequestId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminFeatureFlag(
  featureFlagKey: string,
  body: AdminFeatureFlagPatchRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminFeatureFlag>> {
  return patchJson<AdminFeatureFlag>(
    `/v1/admin/feature-flags/${encodeURIComponent(featureFlagKey)}`,
    body,
    idempotencyKey
  );
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const token = await getSupabaseAccessToken(env);
  const headers = new Headers({ accept: "application/json" });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: await getErrorMessage(response)
      };
    }

    return {
      ok: true,
      data: (await response.json()) as T
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "API is unavailable"
    };
  }
}

async function getSupabaseAccessToken(env: ReturnType<typeof parsePublicWebEnv>) {
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    return null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Server Components cannot persist refreshed cookies. Auth-changing flows run client-side.
      }
    }
  });
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
}

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
    if (typeof body.code === "string" && body.code.length > 0) {
      return body.code;
    }
  } catch {
    return response.statusText || "Request failed";
  }

  return response.statusText || "Request failed";
}

async function patchJson<T>(path: string, body: unknown, idempotencyKey: string): Promise<ApiResult<T>> {
  const env = parsePublicWebEnv(process.env);
  const url = new URL(path, env.NEXT_PUBLIC_API_BASE_URL);
  const token = await getSupabaseAccessToken(env);
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey
  });

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers,
      method: "PATCH"
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: await getErrorMessage(response)
      };
    }

    return {
      ok: true,
      data: (await response.json()) as T
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "API is unavailable"
    };
  }
}
