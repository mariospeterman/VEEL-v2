import type { components } from "@veel/contracts";

export type AgeState = components["schemas"]["AgeState"];
export type AgeStatus = components["schemas"]["AgeStatus"];
export type AgeSession = components["schemas"]["AgeSession"];
export type CreateAgeSessionRequest = components["schemas"]["CreateAgeSessionRequest"];
export type WebhookReceipt = components["schemas"]["WebhookReceipt"];
export type AgeProvider = "yoti" | "sumsub" | "veriff" | "persona" | "didit";
export type AgeProviderPreference = CreateAgeSessionRequest["providerPreference"];

export interface CreatePendingAgeVerificationInput {
  userId: string;
  provider: AgeProvider;
  providerReference: string;
  jurisdiction?: string | null;
  rule?: string | null;
  expiresAt: Date;
  providerExternalUserId?: string | null;
}

export interface AgeRepository {
  findLatestAgeStatusByUserId?(userId: string): Promise<AgeStatus>;
  /** @deprecated Legacy provider-subject lookup for unmigrated route modules. */
  findLatestAgeStatusBySupabaseUserId(supabaseUserId: string): Promise<AgeStatus>;
  createPendingAgeVerification(input: CreatePendingAgeVerificationInput): Promise<void>;
  reservePendingAgeVerification?(input: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ id: string; subjectReference: string }>;
  selectPendingAgeProvider?(input: {
    sessionId: string;
    provider: AgeProvider;
    method: "reusable_age" | "age_estimation" | "non_doc" | "doc_scan" | "gov_id_selfie";
    assuranceLevel: string;
    reusable: boolean;
  }): Promise<void>;
  completePendingAgeVerification?(input: {
    sessionId: string;
    providerSession: AgeProviderSession;
  }): Promise<void>;
  failPendingAgeVerification?(input: { sessionId: string; reason: string }): Promise<void>;
  applyProviderWebhook(input: ApplyAgeProviderWebhookInput): Promise<ProviderWebhookApplyResult>;
  updateVerificationFromWebhook(input: UpdateAgeVerificationFromWebhookInput): Promise<boolean>;
  close?(): Promise<void>;
}

export function findAgeStatusForUser(
  repository: AgeRepository,
  userId: string
): Promise<AgeStatus> {
  if (repository.findLatestAgeStatusByUserId) {
    return repository.findLatestAgeStatusByUserId(userId);
  }

  return repository.findLatestAgeStatusBySupabaseUserId(userId);
}

export type ProviderWebhookApplyResult = "applied" | "duplicate" | "unmatched";

export interface ApplyAgeProviderWebhookInput extends UpdateAgeVerificationFromWebhookInput {
  eventType: string;
  signatureHash: string | null;
  payloadHash?: string;
  providerCorrelationId?: string | null;
}

export interface UpdateAgeVerificationFromWebhookInput {
  provider: AgeProvider;
  providerEventId: string;
  providerReference: string;
  providerSubjectReference?: string | null;
  state: Extract<AgeState, "pending" | "verified" | "failed">;
  verifiedAt?: Date | null;
  failureCode?: string | null;
}

export interface AgeProviderSessionRequest {
  supabaseUserId: string;
  providerPreference: AgeProviderPreference;
  idempotencyKey: string;
  callbackUrl: string;
  webhookBaseUrl: string;
  subjectReference?: string | null;
  onProviderSelected?: (input: {
    provider: AgeProvider;
    method: "reusable_age" | "age_estimation" | "non_doc" | "doc_scan" | "gov_id_selfie";
    assuranceLevel: string;
    reusable: boolean;
  }) => Promise<void>;
}

export interface AgeProviderSession {
  provider: AgeProvider;
  providerReference: string;
  providerExternalUserId?: string | null;
  launchUrl: string;
  expiresAt: Date;
  jurisdiction?: string | null;
  rule?: string | null;
}

export interface AgeProviderWaterfall {
  createSession(input: AgeProviderSessionRequest): Promise<AgeProviderSession>;
}
