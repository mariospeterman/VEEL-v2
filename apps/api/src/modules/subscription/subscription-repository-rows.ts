import type { Subscription, SubscriptionAuthorizationIntent, SubscriptionPlan } from "./types.js";

export interface PlanRow {
  id: string;
  scope: SubscriptionPlan["scope"];
  label: string;
  description: string | null;
  benefits: string[];
  amount_minor: string | number;
  amount_atomic: string | number | null;
  currency: SubscriptionPlan["currency"];
  period_days: number;
  period_seconds: number | null;
  billing_mode: SubscriptionPlan["billingMode"];
  provider_state: SubscriptionPlan["providerState"];
  token_mint: string | null;
  token_program: SubscriptionPlan["tokenProgram"];
  provider: string | null;
  program_id: string | null;
  plan_pda: string | null;
  merchant_wallet: string | null;
  creator_user_id: string | null;
  creator_handle: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
}

export interface SubscriptionRow {
  id: string;
  scope: Subscription["scope"];
  plan_id: string;
  state: Subscription["state"];
  renewal_mode: Subscription["renewalMode"];
  current_period_ends_at: Date | null;
  next_collection_at: Date | null;
  cancelled_at: Date | null;
  revoked_at: Date | null;
  authority_address: string | null;
  delegation_address: string | null;
  subscriber_wallet: string | null;
  subscriber_token_account?: string | null;
  provider: string | null;
  program_id: string | null;
  token_mint: string | null;
  amount_atomic: string | number | null;
  period_seconds: number | null;
  plan_pda: string | null;
  subscription_pda: string | null;
  merchant_wallet: string | null;
  creator_user_id: string | null;
  creator_handle: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
}

export interface AuthorizationIntentRow {
  id: string;
  subscription_id: string;
  setup_reference: string;
  transaction_request_url: string | null;
  expires_at: Date;
  request_hash: string;
  state: SubscriptionAuthorizationIntent["providerReadiness"]["activeMode"] | string;
}
