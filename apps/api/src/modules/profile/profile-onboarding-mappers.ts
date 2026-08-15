import type { CreatorOnboardingResource } from "./types.js";
import type { CreatorOnboardingRow } from "./profile-repository-rows.js";

export function toCreatorOnboarding(row: CreatorOnboardingRow): CreatorOnboardingResource {
  const hasProfile = Boolean(row.handle);
  const hasWallet = Boolean(row.primary_wallet_id) || Number(row.wallet_count) > 0;
  const productsEnabled = [
    row.support_enabled,
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
      actionHref: hasProfile ? null : "/app/settings"
    },
    {
      key: "age",
      label: "Age verification",
      state: stateForAge(row.age_state),
      required: true,
      actionHref: row.age_state === "verified" ? null : "/?mode=onboarding&step=age&next=%2Fapp%2Fprofile%2Fearnings"
    },
    {
      key: "wallet",
      label: "Wallet",
      state: hasWallet ? "complete" : "action_required",
      required: true,
      actionHref: hasWallet ? null : "/app/wallet"
    },
    {
      key: "kyc",
      label: "Creator verification",
      state: stateForKyc(row.kyc_state),
      required: row.kyc_state !== "not_required",
      actionHref: hrefForComplianceState(row.kyc_state, "/app/profile/earnings#creator-verification")
    },
    {
      key: "tax_profile",
      label: "Tax profile",
      state: stateForTax(row.tax_profile_state),
      required: row.tax_profile_state !== "not_required",
      actionHref: hrefForComplianceState(row.tax_profile_state, "/app/profile/earnings#tax-profile")
    },
    {
      key: "recipient_wallet",
      label: "Earnings wallet",
      state: row.earnings_recipient_wallet_id ? "complete" : "action_required",
      required: true,
      actionHref: row.earnings_recipient_wallet_id ? null : "/app/profile/earnings#earnings-wallet"
    },
    {
      key: "products",
      label: "Products",
      state: productsEnabled ? "complete" : "action_required",
      required: true,
      actionHref: productsEnabled ? null : "/app/profile/earnings#products"
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
    configuration: {
      recipientWalletId: row.earnings_recipient_wallet_id,
      earningsTermsVersion: row.earnings_terms_version,
      products: {
        support: row.support_enabled,
        contentUnlocks: row.content_unlocks_enabled,
        eventAccessAndLive: row.live_passes_enabled,
        paidMessages: row.paid_messages_enabled
      }
    },
    steps
  };
}

export function readinessScoreForSteps(steps: CreatorOnboardingResource["steps"]): number {
  const requiredSteps = steps.filter((step) => step.required);
  if (requiredSteps.length === 0) {
    return 100;
  }

  const completeSteps = requiredSteps.filter(
    (step) => step.state === "complete" || step.state === "not_required"
  );
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
