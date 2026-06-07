import type { components } from "@veel/contracts";
import type { CreatorMonetisationDashboardResource } from "./types.js";
import type { DashboardRow, EarningsRow, ProductRow, RecentPaymentRow } from "./profile-repository-rows.js";
import { toUserResource } from "./profile-user-mappers.js";

export function toCreatorDashboard(
  row: DashboardRow,
  earnings: EarningsRow | undefined,
  products: ProductRow[],
  recentPayments: RecentPaymentRow[]
): CreatorMonetisationDashboardResource {
  const blockedReasons: string[] = [];

  if (row.recipient_wallet_state === "missing") {
    blockedReasons.push("earnings_recipient_wallet_required");
  }
  if (row.state !== "active") {
    blockedReasons.push(`creator_state_${row.state}`);
  }
  if (row.earning_state !== "ready") {
    blockedReasons.push(`earning_state_${row.earning_state}`);
  }
  const canMonetize = blockedReasons.length === 0;

  return {
    creator: toUserResource(row),
    readiness: {
      state: row.state,
      earningState: row.earning_state,
      kycState: row.kyc_state,
      taxProfileState: row.tax_profile_state,
      recipientWalletState: row.recipient_wallet_state,
      readinessScore: readinessScoreForDashboard(row),
      canMonetize,
      nextAction: canMonetize ? null : nextActionForDashboard(row),
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
      blockedReasons
    },
    earnings: {
      currency: "SOL",
      creatorEarningsMinor: Number(earnings?.creator_earnings_minor ?? 0),
      platformFeesMinor: Number(earnings?.platform_fees_minor ?? 0),
      referralCommissionsMinor: Number(earnings?.referral_commissions_minor ?? 0),
      confirmedPaymentCount: Number(earnings?.confirmed_payment_count ?? 0)
    },
    products: productSummaries(row, products),
    recentActivity: recentPayments.map(toActivityItem)
  };
}

export function readinessScoreForDashboard(row: DashboardRow): number {
  const checks = [
    row.state === "active",
    row.earning_state === "ready",
    row.kyc_state === "not_required" || row.kyc_state === "verified",
    row.tax_profile_state === "not_required" || row.tax_profile_state === "verified",
    row.recipient_wallet_state === "linked"
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function nextActionForDashboard(row: DashboardRow): string | null {
  if (row.state !== "active") {
    return "/profile";
  }
  if (row.earning_state !== "ready") {
    return "/profile";
  }
  if (row.kyc_state === "required" || row.kyc_state === "failed") {
    return "/settings";
  }
  if (row.tax_profile_state === "required") {
    return "/settings";
  }
  if (row.recipient_wallet_state === "missing") {
    return "/wallet";
  }

  return null;
}

export function productSummaries(
  row: DashboardRow,
  products: ProductRow[]
): CreatorMonetisationDashboardResource["products"] {
  const enabledByProduct: Partial<Record<components["schemas"]["ProductType"], boolean>> = {
    tip: row.tips_enabled,
    support: row.tips_enabled,
    content_unlock: row.content_unlocks_enabled,
    live_pass: row.live_passes_enabled,
    paid_message: row.paid_messages_enabled,
    creator_subscription: row.subscriptions_enabled
  };
  const productRows = new Map(products.map((product) => [product.product_type, product]));

  return (Object.keys(enabledByProduct) as components["schemas"]["ProductType"][]).map(
    (productType) => {
      const product = productRows.get(productType);

      return {
        productType,
        enabled: Boolean(enabledByProduct[productType]),
        confirmedPaymentCount: Number(product?.confirmed_payment_count ?? 0),
        amountMinor: Number(product?.amount_minor ?? 0),
        currency: "SOL"
      };
    }
  );
}

export function toActivityItem(row: RecentPaymentRow): components["schemas"]["ActivityItem"] {
  return {
    id: row.id,
    kind: "payment_intent",
    title: titleForProduct(row.product_type),
    state: row.state,
    productType: row.product_type,
    targetId: row.target_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    paymentIntentId: row.id,
    signature: row.confirmed_signature,
    referenceAddress: row.reference_address,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

export function titleForProduct(productType: components["schemas"]["ProductType"]): string {
  return productType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
