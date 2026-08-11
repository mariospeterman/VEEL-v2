import type { components } from "@veel/contracts";

export type CreateSubscriptionIntentRequest =
  components["schemas"]["CreateSubscriptionIntentRequest"];
export type SubmitSubscriptionAuthorizationRequest =
  components["schemas"]["SubmitSubscriptionAuthorizationRequest"];
export type Subscription = components["schemas"]["Subscription"];
export type SubscriptionAuthorizationIntent =
  components["schemas"]["SubscriptionAuthorizationIntent"];
export type SubscriptionPage = components["schemas"]["SubscriptionPage"];
export type SubscriptionPlan = components["schemas"]["SubscriptionPlan"];
export type SubscriptionPlanPage = components["schemas"]["SubscriptionPlanPage"];
export type PlatformAccess = components["schemas"]["PlatformAccess"];

export interface CreateSubscriptionAuthorizationIntentInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  body: CreateSubscriptionIntentRequest;
  expiresAt: Date;
  collectorAddress: string | null;
  delegationProgramId: string;
  provider: string;
  supportedMints: string[];
}

export interface SubmitSubscriptionAuthorizationInput {
  supabaseUserId: string;
  authorizationIntentId: string;
  idempotencyKey: string;
  body: SubmitSubscriptionAuthorizationRequest;
  verification: SubscriptionAuthorizationVerificationResult;
}

export interface CancelSubscriptionInput {
  supabaseUserId: string;
  subscriptionId: string;
  idempotencyKey: string;
}

export interface SubscriptionAuthorizationVerificationContext {
  authorizationIntentId: string;
  setupReference: string;
  delegationProgramId: string;
  collectorAddress: string | null;
  subscriberWallet: string | null;
  tokenMint: string | null;
  tokenProgram: "spl_token" | "token_2022" | null;
  amountMinor: number;
  periodDays: number;
  provider: string;
  planId: string;
  planPda: string | null;
  subscriptionPda: string | null;
  merchantWallet: string | null;
  expiresAt: Date;
}

export interface SubscriptionRepository {
  getPlatformAccess?(input: { supabaseUserId: string }): Promise<PlatformAccess>;
  listPlans(input: { supabaseUserId: string }): Promise<SubscriptionPlanPage>;
  listSubscriptions(input: { supabaseUserId: string }): Promise<SubscriptionPage>;
  createAuthorizationIntent(
    input: CreateSubscriptionAuthorizationIntentInput
  ): Promise<SubscriptionAuthorizationIntent>;
  findAuthorizationVerificationContext(input: {
    supabaseUserId: string;
    authorizationIntentId: string;
    delegationProgramId: string;
  }): Promise<SubscriptionAuthorizationVerificationContext | null>;
  submitAuthorization(input: SubmitSubscriptionAuthorizationInput): Promise<Subscription | null>;
  cancel(input: CancelSubscriptionInput): Promise<Subscription | null>;
  close?(): Promise<void>;
}

export interface VerifySubscriptionAuthorizationInput {
  signature: string;
  setupReference: string;
  authorityAddress: string;
  delegationAddress: string;
  subscriberTokenAccount: string;
  delegationProgramId: string;
  collectorAddress: string | null;
  subscriberWallet: string | null;
  tokenMint: string | null;
  tokenProgram: "spl_token" | "token_2022" | null;
  amountMinor: number;
  periodDays: number;
  provider: string;
  planId: string;
  planPda: string | null;
  subscriptionPda: string | null;
  merchantWallet: string | null;
  expiresAt: Date;
}

export type SubscriptionVerificationFailureReason =
  | "provider_not_configured"
  | "unsupported_asset"
  | "unsupported_native_sol_subscription"
  | "program_id_mismatch"
  | "plan_not_found"
  | "plan_terms_mismatch"
  | "authority_not_found"
  | "subscription_not_found"
  | "delegation_not_found"
  | "subscriber_mismatch"
  | "creator_mismatch"
  | "merchant_mismatch"
  | "collector_mismatch"
  | "mint_mismatch"
  | "amount_mismatch"
  | "period_mismatch"
  | "expired"
  | "cancelled"
  | "revoked"
  | "transaction_failed"
  | "signature_reused"
  | "intent_expired"
  | "rpc_unavailable"
  | "missing_authorization_evidence";

export interface VerifiedSubscriptionFacts {
  subscriberWallet: string;
  subscriberTokenAccount: string;
  tokenMint: string;
  authorityAddress: string;
  delegationAddress: string;
  subscriptionPda: string | null;
  planPda: string | null;
  programId: string;
  merchantWallet: string | null;
  collectorWallet: string | null;
  amountMinor: number;
  periodDays: number;
  verifiedAt: string;
}

export interface SubscriptionAuthorizationVerificationResult {
  verified: boolean;
  failureCode?: SubscriptionVerificationFailureReason;
  facts?: VerifiedSubscriptionFacts;
  retryable?: boolean;
}

export interface SubscriptionAuthorizationVerifier {
  verifyAuthorization(
    input: VerifySubscriptionAuthorizationInput
  ): Promise<SubscriptionAuthorizationVerificationResult>;
}
