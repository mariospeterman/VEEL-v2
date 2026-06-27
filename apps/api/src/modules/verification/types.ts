export type VerificationSubjectType = "user" | "organization" | "organization_person";
export type VerificationPurpose =
  | "age_access"
  | "adult_content_access"
  | "creator_kyc"
  | "payout_kyc"
  | "org_kyb"
  | "ubo_kyc"
  | "enterprise_review";

export type VerificationProvider = "sumsub" | "yoti" | "persona" | "veriff" | "didit" | "manual" | "internal";
export type VerificationMethod =
  | "reusable_age"
  | "age_estimation"
  | "non_doc"
  | "doc_scan"
  | "gov_id_selfie"
  | "kyb_registry"
  | "manual_review";

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

export interface VerificationSessionResource {
  id: string;
  provider: VerificationProvider;
  providerReference: string;
  launchUrl: string;
  expiresAt: string;
  purpose: VerificationPurpose;
}

export interface CreateVerificationSessionInput {
  supabaseUserId: string;
  purpose: Extract<VerificationPurpose, "creator_kyc" | "org_kyb">;
  providerPreference: "provider_first" | "sumsub" | "didit" | "persona" | "veriff";
  idempotencyKey: string;
  organizationId?: string | null;
  callbackUrl: string;
  webhookBaseUrl: string;
}

export interface VerificationProviderSession {
  provider: VerificationProvider;
  providerReference: string;
  providerSessionId?: string | null;
  providerApplicantId?: string | null;
  providerInquiryId?: string | null;
  providerTransactionId?: string | null;
  launchUrl: string;
  expiresAt: Date;
  method: VerificationMethod;
  assuranceLevel: VerificationRecordResource["assuranceLevel"];
  reusable?: boolean;
}

export interface VerificationProviderWaterfall {
  createSession(input: CreateVerificationSessionInput): Promise<VerificationProviderSession>;
}

export interface NormalizedVerificationWebhook {
  provider: VerificationProvider;
  providerEventId: string;
  providerReference: string;
  eventType: string;
  status: "pending" | "valid" | "invalid" | "blocked";
  signatureHash: string | null;
  occurredAt?: Date | null;
  failureReasonCode?: string | null;
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
  createPendingSession(input: {
    supabaseUserId: string;
    purpose: Extract<VerificationPurpose, "creator_kyc" | "org_kyb">;
    organizationId?: string | null;
    providerSession: VerificationProviderSession;
  }): Promise<string>;
  recordProviderWebhook(input: {
    provider: VerificationProvider;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
  }): Promise<boolean>;
  updateVerificationFromWebhook(input: NormalizedVerificationWebhook): Promise<boolean>;
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
