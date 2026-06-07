import type { AdminRepository } from "./types.js";
import { AdminRepositoryConfigurationError } from "./admin-repository-errors.js";

async function fail(): Promise<never> {
  throw new AdminRepositoryConfigurationError();
}

export function createUnconfiguredAdminRepository(): AdminRepository {
  return {
    hasAdminAccess: fail,
    getOpsSummary: fail,
    getNotificationHealth: fail,
    listUsers: fail,
    getUser: fail,
    listContent: fail,
    updateContentModeration: fail,
    listReports: fail,
    updateReport: fail,
    listPaymentIntents: fail,
    listUnlocks: fail,
    listProviderEvents: fail,
    enqueueProviderEventReplay: fail,
    listAuditEvents: fail,
    listSupportCases: fail,
    updateSupportCase: fail,
    listSupportPolicies: fail,
    updateSupportPolicy: fail,
    listRefundDisputes: fail,
    updateRefundDispute: fail,
    listDataRequests: fail,
    updateDataRequest: fail,
    listEvents: fail,
    listTickets: fail,
    listLiveRooms: fail,
    listMediaAssets: fail,
    listAgeChecks: fail,
    listIdentityChecks: fail,
    listAiSessions: fail,
    listAiToolCalls: fail,
    getMutualsSafety: fail,
    listComplianceLedger: fail,
    listDac7Reports: fail,
    listCarfReports: fail,
    listVatDeterminations: fail,
    listReceipts: fail,
    listInvoices: fail,
    listReferralPrograms: fail,
    listPartnerCampaigns: fail,
    listTierWaivers: fail,
    listOrganizations: fail,
    updateOrganizationKyb: fail,
    listOrganizationMembers: fail,
    updateOrganizationMember: fail,
    listFeatureFlags: fail,
    updateFeatureFlag: fail
  };
}
