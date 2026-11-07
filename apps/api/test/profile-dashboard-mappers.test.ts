import { describe, expect, it } from "vitest";
import { toCreatorDashboard } from "../src/modules/profile/profile-dashboard-mappers.js";
import type { DashboardRow } from "../src/modules/profile/profile-repository-rows.js";

const dashboardRow: DashboardRow = {
  id: "11111111-1111-4111-8111-111111111111",
  handle: "creator",
  display_name: "Creator",
  avatar_url: null,
  state: "active",
  earning_state: "ready",
  kyc_state: "verified",
  tax_profile_state: "verified",
  recipient_wallet_state: "linked",
  support_enabled: true,
  content_unlocks_enabled: true,
  live_passes_enabled: true,
  paid_messages_enabled: true,
  subscriptions_enabled: true
};

describe("creator dashboard projection", () => {
  it("keeps mixed assets separate and preserves aggregate atomic values as strings", () => {
    const dashboard = toCreatorDashboard(
      dashboardRow,
      [
        {
          currency: "SOL",
          creator_earnings_minor: "900719925474099312345",
          platform_fees_minor: "100000000",
          referral_commissions_minor: "0",
          confirmed_payment_count: "2"
        },
        {
          currency: "USDC",
          creator_earnings_minor: "12000000",
          platform_fees_minor: "1000000",
          referral_commissions_minor: "250000",
          confirmed_payment_count: "1"
        }
      ],
      [
        {
          product_type: "support",
          currency: "SOL",
          amount_minor: "900719925474099312345",
          confirmed_payment_count: "2"
        },
        {
          product_type: "support",
          currency: "USDC",
          amount_minor: "12000000",
          confirmed_payment_count: "1"
        }
      ],
      []
    );

    expect(dashboard.earnings).toEqual({
      assets: [
        {
          currency: "SOL",
          creatorEarningsAtomic: "900719925474099312345",
          platformFeesAtomic: "100000000",
          referralCommissionsAtomic: "0",
          confirmedPaymentCount: 2
        },
        {
          currency: "USDC",
          creatorEarningsAtomic: "12000000",
          platformFeesAtomic: "1000000",
          referralCommissionsAtomic: "250000",
          confirmedPaymentCount: 1
        }
      ],
      confirmedPaymentCount: 3
    });
    expect(dashboard.products.find((product) => product.productType === "support")).toEqual({
      productType: "support",
      enabled: true,
      confirmedPaymentCount: 3,
      assets: [
        { currency: "SOL", amountAtomic: "900719925474099312345", confirmedPaymentCount: 2 },
        { currency: "USDC", amountAtomic: "12000000", confirmedPaymentCount: 1 }
      ]
    });
  });
});
