import type { components } from "@veel/contracts";

export type CreateSubscriptionIntentRequest =
  components["schemas"]["CreateSubscriptionIntentRequest"];
export type SubmitSubscriptionAuthorizationRequest =
  components["schemas"]["SubmitSubscriptionAuthorizationRequest"];
export type Subscription = components["schemas"]["Subscription"];
export type SubscriptionAuthorizationIntent =
  components["schemas"]["SubscriptionAuthorizationIntent"];
export type SubscriptionPlan = components["schemas"]["SubscriptionPlan"];
export type SubscriptionPlanPage = components["schemas"]["SubscriptionPlanPage"];

export interface CreateSubscriptionAuthorizationIntentInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  body: CreateSubscriptionIntentRequest;
  expiresAt: Date;
  collectorAddress: string | null;
  delegationProgramId: string;
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
  tokenMint: string | null;
  tokenProgram: "spl_token" | "token_2022" | null;
  amountMinor: number;
  periodDays: number;
}

export interface SubscriptionRepository {
  listPlans(input: { supabaseUserId: string }): Promise<SubscriptionPlanPage>;
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
  tokenMint: string | null;
  tokenProgram: "spl_token" | "token_2022" | null;
  amountMinor: number;
  periodDays: number;
}

export interface SubscriptionAuthorizationVerificationResult {
  verified: boolean;
  failureCode?: string;
}

export interface SubscriptionAuthorizationVerifier {
  verifyAuthorization(
    input: VerifySubscriptionAuthorizationInput
  ): Promise<SubscriptionAuthorizationVerificationResult>;
}
