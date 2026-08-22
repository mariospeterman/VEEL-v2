import type { components } from "@veel/contracts";
import type { ContentDetailRow } from "../content/content-repository-rows.js";

export interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  profile_links?: unknown;
}

export interface CreatorProfileRow extends ProfileRow {
  bio: string | null;
  location_label: string | null;
  content_count: string | number;
  live_room_count: string | number;
  confirmed_payment_count: string | number;
  follower_count: string | number;
  following_count: string | number;
  support_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
  membership_plan_id: string | null;
  membership_label: string | null;
  membership_description: string | null;
  membership_benefits: string[] | null;
  membership_amount_minor: string | number | null;
  membership_amount_atomic: string | number | null;
  membership_provider_state: "staging_required" | "launch_approved" | "disabled" | null;
  membership_token_mint: string | null;
  membership_token_program: "spl_token" | "token_2022" | null;
  membership_program_id: string | null;
  membership_merchant_wallet: string | null;
}

export interface CreatorContentRow extends ContentDetailRow {
  viewer_is_creator: boolean;
}

export interface DashboardRow extends ProfileRow {
  state: "active" | "paused" | "blocked";
  earning_state: "not_configured" | "ready" | "review_required" | "held";
  kyc_state: "not_required" | "required" | "pending" | "verified" | "failed";
  tax_profile_state: "not_required" | "required" | "pending" | "verified";
  recipient_wallet_state: "missing" | "linked";
  support_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
}

export interface CreatorOnboardingRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  age_state: "not_required" | "required" | "pending" | "verified" | "failed" | null;
  primary_wallet_id: string | null;
  wallet_count: string | number;
  state: "active" | "paused" | "blocked";
  earning_state: "not_configured" | "ready" | "review_required" | "held";
  kyc_state: "not_required" | "required" | "pending" | "verified" | "failed";
  tax_profile_state: "not_required" | "required" | "pending" | "verified";
  earnings_recipient_wallet_id: string | null;
  earnings_terms_version: "wevid-creator-earnings-v1" | null;
  support_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
}

export interface EarningsRow {
  creator_earnings_minor: string | number | null;
  platform_fees_minor: string | number | null;
  referral_commissions_minor: string | number | null;
  confirmed_payment_count: string | number | null;
}

export interface ProductRow {
  product_type: components["schemas"]["ProductType"];
  amount_minor: string | number;
  confirmed_payment_count: string | number;
}

export interface RecentPaymentRow {
  id: string;
  product_type: components["schemas"]["ProductType"];
  target_id: string;
  amount_minor: string | number;
  currency: components["schemas"]["Currency"];
  state: components["schemas"]["ActivityItem"]["state"];
  confirmed_signature: string | null;
  reference_address: string;
  created_at: Date;
  confirmed_at: Date | null;
}
