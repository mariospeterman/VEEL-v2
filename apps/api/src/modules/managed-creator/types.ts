export type ManagedCreatorPermission =
  | "profile_readiness_view"
  | "monetisation_settings_manage"
  | "content_manage"
  | "analytics_view"
  | "revenue_allocation";

export interface ManagedCreatorRelationshipResource {
  id: string;
  organizationId: string;
  organizationName: string;
  creatorUserId: string;
  creatorHandle: string;
  state: string;
  agreementId: string;
  agreementVersion: number;
  agreementState: string;
  permissions: ManagedCreatorPermission[];
  creatorShareBps: number;
  enterpriseManagementShareBps: number;
  organizationKybReady: boolean;
  enterpriseEntitlementReady: boolean;
  settlementWalletReady: boolean;
  viewerRole: "creator" | "organization_member";
  organizationRole: "owner" | "admin" | "member" | "viewer" | null;
  availableActions: Array<
    | "accept_relationship"
    | "decline_relationship"
    | "propose_agreement"
    | "accept_agreement"
    | "reject_agreement"
    | "terminate_relationship"
  >;
}

export interface ManagedCreatorReportingResource {
  relationshipId: string;
  organizationId: string;
  creatorUserId: string;
  totals: Array<{
    currency: "SOL" | "USDC";
    confirmedPaymentCount: number;
    creatorSideProceedsMinor: number;
    creatorNetMinor: number;
    enterpriseManagementMinor: number;
  }>;
  generatedAt: string;
  financeBoundary: "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue";
}

export interface ManagedCreatorRepository {
  listMine(input: { supabaseUserId: string }): Promise<ManagedCreatorRelationshipResource[]>;
  getReporting(input: {
    supabaseUserId: string;
    relationshipId: string;
  }): Promise<ManagedCreatorReportingResource | null>;
  invite(input: {
    supabaseUserId: string;
    organizationId: string;
    creatorHandle: string;
    permissions: ManagedCreatorPermission[];
    enterpriseManagementShareBps: number;
    termsHash: string;
    settlementWalletId?: string | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  respond(input: {
    supabaseUserId: string;
    relationshipId: string;
    decision: "accept" | "decline";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  proposeAgreement(input: {
    supabaseUserId: string;
    relationshipId: string;
    permissions: ManagedCreatorPermission[];
    enterpriseManagementShareBps: number;
    termsHash: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  respondToAgreement(input: {
    supabaseUserId: string;
    relationshipId: string;
    agreementId: string;
    decision: "accept" | "reject";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  terminate(input: {
    supabaseUserId: string;
    relationshipId: string;
    reason: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  close?(): Promise<void>;
}
