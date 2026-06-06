import type { components } from "@veel/contracts";

export type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
export type AdminNotificationHealth = components["schemas"]["AdminNotificationHealth"];
export type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
export type AdminUnlock = components["schemas"]["AdminUnlock"];
export type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];
export type AdminDatingSafety = components["schemas"]["AdminDatingSafety"];
export type AdminComplianceLedgerEntry = components["schemas"]["AdminComplianceLedgerEntry"];
export type AdminComplianceReport = components["schemas"]["AdminComplianceReport"];
export type AdminVatDetermination = components["schemas"]["AdminVatDetermination"];
export type AdminReceipt = components["schemas"]["AdminReceipt"];
export type AdminInvoice = components["schemas"]["AdminInvoice"];
export type AdminReferralProgram = components["schemas"]["AdminReferralProgram"];
export type AdminPartnerCampaign = components["schemas"]["AdminPartnerCampaign"];
export type AdminTierWaiver = components["schemas"]["AdminTierWaiver"];
export type AdminOrganization = components["schemas"]["AdminOrganization"];

export interface AdminPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

export interface AdminRepository {
  hasAdminAccess(supabaseUserId: string): Promise<boolean>;
  getOpsSummary(): Promise<AdminOpsSummary>;
  getNotificationHealth(): Promise<AdminNotificationHealth>;
  listPaymentIntents(input: { query?: string; cursor?: string }): Promise<AdminPage<AdminPaymentIntent>>;
  listUnlocks(input: { query?: string; cursor?: string }): Promise<AdminPage<AdminUnlock>>;
  listProviderEvents(input: { cursor?: string }): Promise<AdminPage<AdminProviderEvent>>;
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
  close?(): Promise<void>;
}
