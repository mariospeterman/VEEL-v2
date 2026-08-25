export type LandingClaimClass =
  | "canonical_product_fact"
  | "current_backend_policy"
  | "externally_sourced_fact"
  | "illustrative_example";

export type LandingClaimPlacement =
  | "hero"
  | "proof"
  | "money"
  | "product"
  | "comparison"
  | "tiers";

export interface LandingClaim {
  id: string;
  wording: string;
  claimClass: LandingClaimClass;
  evidenceOwner: string;
  lastVerified: string;
  approval: "approved" | "pending_legal";
  qualification: string;
  placements: readonly LandingClaimPlacement[];
}

export const landingMoneyExample = {
  gross: "1.00",
  creator: "0.90",
  platform: "0.10",
  currency: "USDC"
} as const;

export const landingClaims = [
  {
    id: "checkout-one-approval",
    wording: "1 wallet-approved transaction",
    claimClass: "canonical_product_fact",
    evidenceOwner: "payments-and-monetisation.md + payment contracts",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "Access changes only after network confirmation and backend settlement verification.",
    placements: ["proof", "money"]
  },
  {
    id: "default-platform-fee",
    wording: "10% default platform fee",
    claimClass: "current_backend_policy",
    evidenceOwner: "business-monetisation.md + backend commercial policy",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "Default for eligible paid products; the final backend quote controls each transaction.",
    placements: ["hero", "proof", "money", "comparison"]
  },
  {
    id: "no-platform-balances",
    wording: "0 WeVid creator balances or withdrawal queues",
    claimClass: "canonical_product_fact",
    evidenceOwner: "AGENTS.md + noncustodial architecture",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "WeVid does not hold creator product funds in an internal platform balance.",
    placements: ["proof", "money", "comparison"]
  },
  {
    id: "no-pay-to-rank",
    wording: "0 pay-to-rank mechanics",
    claimClass: "canonical_product_fact",
    evidenceOwner: "AGENTS.md + ranking policy and tests",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "Money cannot buy organic ranking, Mutuals treatment, reach, or message priority.",
    placements: ["proof", "product", "comparison", "tiers"]
  },
  {
    id: "one-usdc-example",
    wording: `${landingMoneyExample.gross} ${landingMoneyExample.currency} → ${landingMoneyExample.creator} creator + ${landingMoneyExample.platform} WeVid`,
    claimClass: "illustrative_example",
    evidenceOwner: "business-monetisation.md default split policy",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "Illustrative default-fee example. Network costs, taxes, referrals, management allocations, and the final backend quote may change exact amounts.",
    placements: ["money"]
  },
  {
    id: "no-card-chargeback-rail",
    wording: "Blockchain settlement does not use the card chargeback rail",
    claimClass: "canonical_product_fact",
    evidenceOwner: "payments-and-monetisation.md + Solana settlement contracts",
    lastVerified: "2026-08-25",
    approval: "approved",
    qualification: "Refund, dispute, consumer-law, and remediation duties still apply.",
    placements: ["money"]
  },
  {
    id: "sub-600ms-settlement",
    wording: "Settlement in under 600ms",
    claimClass: "externally_sourced_fact",
    evidenceOwner: "staging payment latency evidence + Legal",
    lastVerified: "2026-08-25",
    approval: "pending_legal",
    qualification: "Do not publish until repeated real-network confirmation measurements and legal review support the exact scope and percentile.",
    placements: ["hero", "money"]
  },
  {
    id: "external-reach-research",
    wording: "53% of surveyed creators said reaching followers was harder than five years earlier.",
    claimClass: "externally_sourced_fact",
    evidenceOwner: "Patreon State of Create 2025",
    lastVerified: "2026-08-25",
    approval: "pending_legal",
    qualification: "Patreon-commissioned 2025 creator/fan research; scope and methodology must accompany publication.",
    placements: ["hero"]
  }
] as const satisfies readonly LandingClaim[];

export function approvedLandingClaim(id: string): LandingClaim {
  const claim = landingClaims.find((candidate) => candidate.id === id);
  if (!claim || claim.approval !== "approved") {
    throw new Error(`Landing claim is not approved: ${id}`);
  }
  return claim;
}
