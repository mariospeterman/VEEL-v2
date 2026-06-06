import type { components } from "@veel/contracts";

export type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
export type AdminNotificationHealth = components["schemas"]["AdminNotificationHealth"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AdminContentItem = components["schemas"]["AdminContentItem"];
export type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
export type AdminUnlock = components["schemas"]["AdminUnlock"];
export type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];
export type AdminReport = components["schemas"]["AdminReport"];
export type AdminUser = components["schemas"]["AdminUser"];
export type AdminDatingSafety = components["schemas"]["AdminDatingSafety"];
export type AdminComplianceLedgerEntry = components["schemas"]["AdminComplianceLedgerEntry"];
export type AdminComplianceReport = components["schemas"]["AdminComplianceReport"];
export type AdminVatDetermination = components["schemas"]["AdminVatDetermination"];
export type AdminReceipt = components["schemas"]["AdminReceipt"];
export type AdminInvoice = components["schemas"]["AdminInvoice"];
export type AdminSupportCase = components["schemas"]["AdminSupportCase"];
export type AdminSupportPolicy = components["schemas"]["AdminSupportPolicy"];
export type AdminRefundDispute = components["schemas"]["AdminRefundDispute"];
export type AdminDataRequest = components["schemas"]["AdminDataRequest"];
export type AdminReferralProgram = components["schemas"]["AdminReferralProgram"];
export type AdminPartnerCampaign = components["schemas"]["AdminPartnerCampaign"];
export type AdminTierWaiver = components["schemas"]["AdminTierWaiver"];
export type AdminOrganization = components["schemas"]["AdminOrganization"];
export type AdminOrganizationMember = components["schemas"]["AdminOrganizationMember"];
export type AdminFeatureFlag = components["schemas"]["AdminFeatureFlag"];
export type AdminOrganizationKybActionRequest =
  components["schemas"]["AdminOrganizationKybActionRequest"];
export type AdminLiveRoom = components["schemas"]["AdminLiveRoom"];
export type AdminMediaAsset = components["schemas"]["AdminMediaAsset"];
export type AdminAgeCheck = components["schemas"]["AdminAgeCheck"];
export type AdminIdentityCheck = components["schemas"]["AdminIdentityCheck"];
export type AdminAiSession = components["schemas"]["AdminAiSession"];
export type AdminAiToolCall = components["schemas"]["AdminAiToolCall"];
export type AdminOrganizationMemberActionRequest =
  components["schemas"]["AdminOrganizationMemberActionRequest"];
export type AdminSupportCaseActionRequest = components["schemas"]["AdminSupportCaseActionRequest"];
export type AdminSupportPolicyActionRequest =
  components["schemas"]["AdminSupportPolicyActionRequest"];
export type AdminRefundDisputeActionRequest =
  components["schemas"]["AdminRefundDisputeActionRequest"];
export type AdminDataRequestActionRequest =
  components["schemas"]["AdminDataRequestActionRequest"];
export type AdminFeatureFlagPatchRequest =
  components["schemas"]["AdminFeatureFlagPatchRequest"];
export type AdminModerationActionRequest =
  components["schemas"]["AdminModerationActionRequest"];
export type AdminReportActionRequest = components["schemas"]["AdminReportActionRequest"];
export type AdminReasonRequest = components["schemas"]["AdminReasonRequest"];
export type Event = components["schemas"]["Event"];
export type EventTicketType = components["schemas"]["EventTicketType"];
export type Ticket = components["schemas"]["Ticket"];

export interface AdminPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

export interface AdminRepository {
  hasAdminAccess(supabaseUserId: string): Promise<boolean>;
  getOpsSummary(): Promise<AdminOpsSummary>;
  getNotificationHealth(): Promise<AdminNotificationHealth>;
  listUsers(input: { query?: string; cursor?: string }): Promise<AdminPage<AdminUser>>;
  getUser(input: { userId: string }): Promise<AdminUser | null>;
  listContent(input: { cursor?: string }): Promise<AdminPage<AdminContentItem>>;
  updateContentModeration(input: {
    supabaseUserId: string;
    contentId: string;
    body: AdminModerationActionRequest;
    idempotencyKey: string;
  }): Promise<AdminContentItem | null>;
  listReports(input: { cursor?: string }): Promise<AdminPage<AdminReport>>;
  updateReport(input: {
    supabaseUserId: string;
    reportId: string;
    body: AdminReportActionRequest;
    idempotencyKey: string;
  }): Promise<AdminReport | null>;
  listPaymentIntents(input: { query?: string; cursor?: string }): Promise<AdminPage<AdminPaymentIntent>>;
  listUnlocks(input: { query?: string; cursor?: string }): Promise<AdminPage<AdminUnlock>>;
  listProviderEvents(input: { cursor?: string }): Promise<AdminPage<AdminProviderEvent>>;
  enqueueProviderEventReplay(input: {
    supabaseUserId: string;
    providerEventId: string;
    body: AdminReasonRequest;
    idempotencyKey: string;
  }): Promise<boolean>;
  listAuditEvents(input: { cursor?: string }): Promise<AdminPage<AuditEvent>>;
  listSupportCases(input: { cursor?: string }): Promise<AdminPage<AdminSupportCase>>;
  updateSupportCase(input: {
    supabaseUserId: string;
    supportCaseId: string;
    body: AdminSupportCaseActionRequest;
    idempotencyKey: string;
  }): Promise<AdminSupportCase | null>;
  listSupportPolicies(input: { cursor?: string }): Promise<AdminPage<AdminSupportPolicy>>;
  updateSupportPolicy(input: {
    supabaseUserId: string;
    supportPolicyId: string;
    body: AdminSupportPolicyActionRequest;
    idempotencyKey: string;
  }): Promise<AdminSupportPolicy | null>;
  listRefundDisputes(input: { cursor?: string }): Promise<AdminPage<AdminRefundDispute>>;
  updateRefundDispute(input: {
    supabaseUserId: string;
    refundDisputeId: string;
    body: AdminRefundDisputeActionRequest;
    idempotencyKey: string;
  }): Promise<AdminRefundDispute | null>;
  listDataRequests(input: { cursor?: string }): Promise<AdminPage<AdminDataRequest>>;
  updateDataRequest(input: {
    supabaseUserId: string;
    dataRequestId: string;
    body: AdminDataRequestActionRequest;
    idempotencyKey: string;
  }): Promise<AdminDataRequest | null>;
  listEvents(input: { cursor?: string }): Promise<AdminPage<Event>>;
  listTickets(input: { cursor?: string }): Promise<AdminPage<Ticket>>;
  listLiveRooms(input: { cursor?: string }): Promise<AdminPage<AdminLiveRoom>>;
  listMediaAssets(input: { cursor?: string }): Promise<AdminPage<AdminMediaAsset>>;
  listAgeChecks(input: { cursor?: string }): Promise<AdminPage<AdminAgeCheck>>;
  listIdentityChecks(input: { cursor?: string }): Promise<AdminPage<AdminIdentityCheck>>;
  listAiSessions(input: { cursor?: string }): Promise<AdminPage<AdminAiSession>>;
  listAiToolCalls(input: { cursor?: string }): Promise<AdminPage<AdminAiToolCall>>;
  getDatingSafety(): Promise<AdminDatingSafety>;
  listComplianceLedger(input: { cursor?: string }): Promise<AdminPage<AdminComplianceLedgerEntry>>;
  listDac7Reports(input: { cursor?: string }): Promise<AdminPage<AdminComplianceReport>>;
  listCarfReports(input: { cursor?: string }): Promise<AdminPage<AdminComplianceReport>>;
  listVatDeterminations(input: { cursor?: string }): Promise<AdminPage<AdminVatDetermination>>;
  listReceipts(input: { cursor?: string }): Promise<AdminPage<AdminReceipt>>;
  listInvoices(input: { cursor?: string }): Promise<AdminPage<AdminInvoice>>;
  listReferralPrograms(input: { cursor?: string }): Promise<AdminPage<AdminReferralProgram>>;
  listPartnerCampaigns(input: { cursor?: string }): Promise<AdminPage<AdminPartnerCampaign>>;
  listTierWaivers(input: { cursor?: string }): Promise<AdminPage<AdminTierWaiver>>;
  listOrganizations(input: { cursor?: string }): Promise<AdminPage<AdminOrganization>>;
  updateOrganizationKyb(input: {
    supabaseUserId: string;
    organizationId: string;
    body: AdminOrganizationKybActionRequest;
    idempotencyKey: string;
  }): Promise<AdminOrganization | null>;
  listOrganizationMembers(input: {
    organizationId: string;
    cursor?: string;
  }): Promise<AdminPage<AdminOrganizationMember>>;
  updateOrganizationMember(input: {
    supabaseUserId: string;
    organizationId: string;
    membershipId: string;
    body: AdminOrganizationMemberActionRequest;
    idempotencyKey: string;
  }): Promise<AdminOrganizationMember | null>;
  listFeatureFlags(): Promise<AdminPage<AdminFeatureFlag>>;
  updateFeatureFlag(input: {
    supabaseUserId: string;
    featureFlagKey: string;
    body: AdminFeatureFlagPatchRequest;
    idempotencyKey: string;
  }): Promise<AdminFeatureFlag | null>;
  close?(): Promise<void>;
}
