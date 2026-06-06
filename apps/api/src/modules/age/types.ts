import type { components } from "@veel/contracts";

export type AgeState = components["schemas"]["AgeState"];
export type AgeStatus = components["schemas"]["AgeStatus"];
export type AgeSession = components["schemas"]["AgeSession"];
export type CreateAgeSessionRequest = components["schemas"]["CreateAgeSessionRequest"];
export type WebhookReceipt = components["schemas"]["WebhookReceipt"];
export type AgeProvider = "yoti" | "sumsub" | "veriff" | "persona";
export type AgeProviderPreference = CreateAgeSessionRequest["providerPreference"];

export interface CreatePendingAgeVerificationInput {
  supabaseUserId: string;
  provider: AgeProvider;
  providerReference: string;
  jurisdiction?: string | null;
  rule?: string | null;
  expiresAt: Date;
}

export interface AgeRepository {
  findLatestAgeStatusBySupabaseUserId(supabaseUserId: string): Promise<AgeStatus>;
  createPendingAgeVerification(input: CreatePendingAgeVerificationInput): Promise<void>;
  recordProviderWebhook(input: RecordAgeProviderWebhookInput): Promise<boolean>;
  updateVerificationFromWebhook(input: UpdateAgeVerificationFromWebhookInput): Promise<boolean>;
  close?(): Promise<void>;
}

export interface RecordAgeProviderWebhookInput {
  provider: AgeProvider;
  providerEventId: string;
  eventType: string;
  normalizedState: AgeState;
  signatureHash: string | null;
}

export interface UpdateAgeVerificationFromWebhookInput {
  provider: AgeProvider;
  providerEventId: string;
  providerReference: string;
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
}

export interface AgeProviderSession {
  provider: AgeProvider;
  providerReference: string;
  launchUrl: string;
  expiresAt: Date;
  jurisdiction?: string | null;
  rule?: string | null;
}

export interface AgeProviderAdapter {
  provider: AgeProvider;
  isConfigured(): boolean;
  createSession(input: AgeProviderSessionRequest): Promise<AgeProviderSession>;
}

export interface AgeProviderWaterfall {
  createSession(input: AgeProviderSessionRequest): Promise<AgeProviderSession>;
}
