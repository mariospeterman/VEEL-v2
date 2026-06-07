import type { components } from "@veel/contracts";
import type { CreatorMonetisationDashboardResource, CreatorOnboardingResource, CreatorProfileResource, UserResource } from "./types.js";
import type { CreatorContentRow, CreatorOnboardingRow, CreatorProfileRow, DashboardRow, EarningsRow, ProductRow, ProfileRow, RecentPaymentRow } from "./profile-repository-rows.js";

export function toUserResource(row: ProfileRow): UserResource {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    badges: []
  };
}

export function toCreatorProfile(
  row: CreatorProfileRow,
  recentContent: CreatorContentRow[]
): CreatorProfileResource {
  return {
    user: toUserResource(row),
    bio: row.bio,
    locationLabel: row.location_label,
    stats: {
      contentCount: Number(row.content_count),
      liveRoomCount: Number(row.live_room_count),
      confirmedPaymentCount: Number(row.confirmed_payment_count),
      followerCount: 0
    },
    monetisation: {
      tipsEnabled: row.tips_enabled,
      contentUnlocksEnabled: row.content_unlocks_enabled,
      livePassesEnabled: row.live_passes_enabled,
      paidMessagesEnabled: row.paid_messages_enabled,
      subscriptionsEnabled: row.subscriptions_enabled
    },
    recentContent: recentContent.map(toContentItem)
  };
}

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

export function toCreatorOnboarding(row: CreatorOnboardingRow): CreatorOnboardingResource {
  const hasProfile = Boolean(row.handle && row.display_name);
  const hasWallet = Boolean(row.primary_wallet_id) || Number(row.wallet_count) > 0;
  const productsEnabled = [
    row.tips_enabled,
    row.content_unlocks_enabled,
    row.live_passes_enabled,
    row.paid_messages_enabled,
    row.subscriptions_enabled
  ].some(Boolean);

  const steps: CreatorOnboardingResource["steps"] = [
    {
      key: "profile",
      label: "Profile",
      state: hasProfile ? "complete" : "action_required",
      required: true,
      actionHref: hasProfile ? null : "/settings"
    },
    {
      key: "age",
      label: "Age verification",
      state: stateForAge(row.age_state),
      required: true,
      actionHref: row.age_state === "verified" ? null : "/age"
    },
    {
      key: "wallet",
      label: "Wallet",
      state: hasWallet ? "complete" : "action_required",
      required: true,
      actionHref: hasWallet ? null : "/wallet"
    },
    {
      key: "kyc",
      label: "Creator verification",
      state: stateForKyc(row.kyc_state),
      required: row.kyc_state !== "not_required",
      actionHref: hrefForComplianceState(row.kyc_state, "/settings")
    },
    {
      key: "tax_profile",
      label: "Tax profile",
      state: stateForTax(row.tax_profile_state),
      required: row.tax_profile_state !== "not_required",
      actionHref: hrefForComplianceState(row.tax_profile_state, "/settings")
    },
    {
      key: "recipient_wallet",
      label: "Earnings wallet",
      state: row.earnings_recipient_wallet_id ? "complete" : "action_required",
      required: true,
      actionHref: row.earnings_recipient_wallet_id ? null : "/wallet"
    },
    {
      key: "products",
      label: "Products",
      state: productsEnabled ? "complete" : "action_required",
      required: true,
      actionHref: productsEnabled ? null : "/profile"
    }
  ];

  const requiredStepsReady = steps
    .filter((step) => step.required)
    .every((step) => step.state === "complete" || step.state === "not_required");
  const hasBlockedStep = steps.some((step) => step.state === "blocked");
  const hasReviewStep = steps.some((step) => step.state === "review_required");

  const state: CreatorOnboardingResource["state"] =
    row.state === "blocked" || row.earning_state === "held" || hasBlockedStep
      ? "blocked"
      : row.earning_state === "review_required" || hasReviewStep
        ? "review_required"
        : row.state === "active" && row.earning_state === "ready" && requiredStepsReady
          ? "ready"
          : "action_required";

  const nextStep = steps.find(
    (step) =>
      step.state === "action_required" ||
      step.state === "review_required" ||
      step.state === "blocked"
  );

  return {
    state,
    canStartEarning: state === "ready",
    readinessScore: readinessScoreForSteps(steps),
    nextAction: nextStep?.actionHref ?? null,
    policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
    steps
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

export function readinessScoreForSteps(steps: CreatorOnboardingResource["steps"]): number {
  const requiredSteps = steps.filter((step) => step.required);
  if (requiredSteps.length === 0) {
    return 100;
  }

  const completeSteps = requiredSteps.filter((step) => step.state === "complete" || step.state === "not_required");
  return Math.round((completeSteps.length / requiredSteps.length) * 100);
}

export function stateForAge(
  state: CreatorOnboardingRow["age_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  if (state === "failed") {
    return "blocked";
  }
  return "action_required";
}

export function stateForKyc(
  state: CreatorOnboardingRow["kyc_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "not_required") {
    return "not_required";
  }
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  if (state === "failed") {
    return "blocked";
  }
  return "action_required";
}

export function stateForTax(
  state: CreatorOnboardingRow["tax_profile_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "not_required") {
    return "not_required";
  }
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  return "action_required";
}

export function hrefForComplianceState(
  state: CreatorOnboardingRow["kyc_state"] | CreatorOnboardingRow["tax_profile_state"],
  href: string
): string | null {
  return state === "required" || state === "failed" ? href : null;
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

export function toContentItem(row: CreatorContentRow): components["schemas"]["ContentItem"] {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl: row.poster_url,
    playback: {
      state: "not_ready",
      url: null,
      provider: "none"
    },
    accessState: "free",
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: false,
      saved: false,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0
    }
  };
}

export function titleForProduct(productType: components["schemas"]["ProductType"]): string {
  return productType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
