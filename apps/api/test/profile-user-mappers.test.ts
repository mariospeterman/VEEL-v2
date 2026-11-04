import { describe, expect, it } from "vitest";
import { toCreatorProfile } from "../src/modules/profile/profile-user-mappers.js";
import type { CreatorProfileRow } from "../src/modules/profile/profile-repository-rows.js";

describe("public creator profile projection", () => {
  it("uses the canonical subscription-plan fields without hardcoded billing terms", () => {
    const row: CreatorProfileRow = {
      id: "11111111-1111-4111-8111-111111111111",
      handle: "creator",
      display_name: "Creator",
      avatar_url: null,
      profile_links: [],
      bio: null,
      location_label: null,
      content_count: "0",
      live_room_count: "0",
      confirmed_payment_count: "0",
      follower_count: "0",
      following_count: "0",
      support_enabled: true,
      content_unlocks_enabled: true,
      live_passes_enabled: true,
      paid_messages_enabled: true,
      subscriptions_enabled: true,
      membership_plan_id: "creator-plan",
      membership_label: "Weekly membership",
      membership_description: "Canonical terms",
      membership_benefits: ["Archive access"],
      membership_amount_minor: "1250",
      membership_amount_atomic: "12500000",
      membership_currency: "USDC",
      membership_period_days: 7,
      membership_period_seconds: 604800,
      membership_billing_mode: "delegated_solana_subscription",
      membership_provider_state: "launch_approved",
      membership_provider: "official_solana_subscription_program",
      membership_token_mint: "mint",
      membership_token_program: "token_2022",
      membership_program_id: "program",
      membership_plan_pda: "plan-pda",
      membership_merchant_wallet: "merchant"
    };

    expect(toCreatorProfile(row, []).monetisation.membershipOffer).toMatchObject({
      id: "creator-plan",
      creator: { id: row.id, handle: "creator" },
      currency: "USDC",
      amountMinor: 1250,
      amountAtomic: 12500000,
      periodDays: 7,
      periodSeconds: 604800,
      providerState: "launch_approved",
      provider: "official_solana_subscription_program",
      tokenProgram: "token_2022",
      planPda: "plan-pda"
    });
  });
});
