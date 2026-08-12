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
}

export interface ManagedCreatorRepository {
  listMine(input: { supabaseUserId: string }): Promise<ManagedCreatorRelationshipResource[]>;
  invite(input: {
    supabaseUserId: string;
    organizationId: string;
    creatorHandle: string;
    permissions: ManagedCreatorPermission[];
    enterpriseManagementShareBps: number;
    termsHash: string;
    settlementWalletId?: string | null;
    idempotencyKey: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  respond(input: {
    supabaseUserId: string;
    relationshipId: string;
    decision: "accept" | "decline";
  }): Promise<ManagedCreatorRelationshipResource | null>;
  proposeAgreement(input: {
    supabaseUserId: string;
    relationshipId: string;
    permissions: ManagedCreatorPermission[];
    enterpriseManagementShareBps: number;
    termsHash: string;
    idempotencyKey: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  respondToAgreement(input: {
    supabaseUserId: string;
    relationshipId: string;
    agreementId: string;
    decision: "accept" | "reject";
  }): Promise<ManagedCreatorRelationshipResource | null>;
  terminate(input: {
    supabaseUserId: string;
    relationshipId: string;
    reason: string;
  }): Promise<ManagedCreatorRelationshipResource | null>;
  close?(): Promise<void>;
}
