export type VerificationSubjectType = "user" | "organization" | "organization_person" | "performer";
export type VerificationPurpose =
  | "age_access"
  | "adult_publisher_eligibility"
  | "performer_eligibility"
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
  | "canPublishAdultMedia"
  | "canMonetize"
  | "canReceiveCreatorProceeds"
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
  purpose: Extract<
    VerificationPurpose,
    "age_access" | "adult_publisher_eligibility" | "creator_kyc" | "org_kyb"
    | "performer_eligibility"
  >;
  providerPreference:
    | "provider_first"
    | "reusable_first"
    | "sumsub"
    | "didit"
    | "yoti"
    | "persona"
    | "veriff";
  idempotencyKey: string;
  organizationId?: string | null;
  subjectReference?: string | null;
  callbackUrl: string;
  webhookBaseUrl: string;
  policyVersion?: string | null;
  termsAcceptedAt?: Date | null;
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
  identityEvidence?: {
    documentApproved: boolean;
    livenessApproved: boolean;
    faceMatchApproved: boolean;
  } | null;
}

export interface CapabilityResolution {
  capabilities: Record<CapabilityKey, boolean>;
  missingRequirements: string[];
  nextBestAction: string;
  verificationSummary: {
    ageAccess: VerificationRecordResource | null;
    adultPublisherEligibility: VerificationRecordResource | null;
    creatorKyc: VerificationRecordResource | null;
    orgKyb: VerificationRecordResource | null;
  };
}

export interface ResolveCapabilitiesInput {
  supabaseUserId: string;
  organizationId?: string | null;
}

export interface VerificationRepository {
  authorizeOrganizationVerification(input: {
    supabaseUserId: string;
    organizationId: string;
    access: "read" | "manage";
  }): Promise<boolean>;
  createPendingSession(input: {
    supabaseUserId: string;
    purpose: Extract<
      VerificationPurpose,
      "age_access" | "adult_publisher_eligibility" | "creator_kyc" | "org_kyb"
    >;
    organizationId?: string | null;
    providerSession: VerificationProviderSession;
    policyVersion?: string | null;
    termsAcceptedAt?: Date | null;
  }): Promise<string>;
  applyProviderWebhook(input: NormalizedVerificationWebhook & {
    payloadHash: string;
  }): Promise<"applied" | "duplicate" | "unmatched">;
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
