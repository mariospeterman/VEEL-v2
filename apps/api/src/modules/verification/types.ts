export type VerificationSubjectType = "user" | "organization" | "organization_person";
export type VerificationPurpose =
  | "age_access"
  | "adult_content_access"
  | "creator_kyc"
  | "payout_kyc"
  | "org_kyb"
  | "ubo_kyc"
  | "enterprise_review";

export type CapabilityKey =
  | "canAccessApp"
  | "canCreateProfile"
  | "canViewAgeRestrictedContent"
  | "canStartCreatorOnboarding"
  | "canCreateDraft"
  | "canUploadMedia"
  | "canPublishMedia"
  | "canMonetize"
  | "canReceivePayouts"
  | "canAccessCreatorDashboard"
  | "canCreateOrganization"
  | "canAccessStudio"
  | "canInviteTeam"
  | "canUseTeamPublishing"
  | "canUseAllocationWallets"
  | "canUseComplianceExports"
  | "canAccessEnterprise";

export interface VerificationRecordResource {
  subjectType: VerificationSubjectType;
  subjectId: string;
  purpose: VerificationPurpose;
  status: "valid" | "invalid" | "pending" | "expired" | "revoked" | "blocked";
  provider: string;
  method: string;
  assuranceLevel: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  reusable: boolean;
}

export interface CapabilityResolution {
  capabilities: Record<CapabilityKey, boolean>;
  missingRequirements: string[];
  nextBestAction: string;
  verificationSummary: {
    ageAccess: VerificationRecordResource | null;
    creatorKyc: VerificationRecordResource | null;
    orgKyb: VerificationRecordResource | null;
  };
}

export interface ResolveCapabilitiesInput {
  supabaseUserId: string;
  organizationId?: string | null;
}

export interface VerificationRepository {
  findLatestUserVerification(input: {
    supabaseUserId: string;
    purpose: VerificationPurpose;
  }): Promise<VerificationRecordResource | null>;
  findLatestOrganizationVerification(input: {
    organizationId: string;
    purpose: VerificationPurpose;
  }): Promise<VerificationRecordResource | null>;
  resolveCapabilities(input: ResolveCapabilitiesInput): Promise<CapabilityResolution>;
  close?(): Promise<void>;
}
