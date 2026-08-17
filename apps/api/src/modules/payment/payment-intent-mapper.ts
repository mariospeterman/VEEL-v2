import type { StoredPaymentIntent } from "./types.js";

export interface PaymentIntentRow {
  id: string;
  product_type: StoredPaymentIntent["productType"];
  target_id: string;
  amount_minor: number;
  currency: StoredPaymentIntent["currency"];
  state: StoredPaymentIntent["state"];
  reference_address: string;
  treasury_wallet: string;
  settlement_kind: StoredPaymentIntent["settlementKind"];
  buyer_wallet: string | null;
  creator_wallet: string | null;
  enterprise_wallet: string | null;
  platform_fee_wallet: string | null;
  referral_wallet: string | null;
  total_amount_minor: number | null;
  creator_side_proceeds_minor: number | null;
  creator_amount_minor: number | null;
  enterprise_management_amount_minor: number | null;
  platform_fee_gross_minor: number | null;
  platform_fee_amount_minor: number | null;
  referral_amount_minor: number | null;
  token_mint: string | null;
  token_decimals: number | null;
  solana_cluster: StoredPaymentIntent["solanaCluster"];
  expires_at: Date;
  quoted_at: Date;
  minimum_amount_minor: number;
  platform_fee_bps: number;
  referral_share_of_platform_fee_bps: number;
  commercial_policy_source: StoredPaymentIntent["commercialPolicySource"];
  commercial_policy_revision: number;
  request_hash: string;
  withdrawal_waiver_required: boolean;
  withdrawal_waiver_accepted_at: Date | null;
  withdrawal_waiver_version: string | null;
  terms_version: string | null;
  durable_confirmation_required: boolean;
  refund_value_basis: StoredPaymentIntent["refundValueBasis"];
}

export function toStoredPaymentIntent(row: PaymentIntentRow): StoredPaymentIntent {
  const refundPolicy: StoredPaymentIntent["refundPolicy"] = {
    withdrawalWaiverRequired: row.withdrawal_waiver_required,
    withdrawalWaiverAcceptedAt: row.withdrawal_waiver_accepted_at?.toISOString() ?? null,
    withdrawalWaiverVersion: row.withdrawal_waiver_version ?? "instant-digital-access-v1",
    termsVersion: row.terms_version ?? "veel-terms-v1",
    durableConfirmationRequired: row.durable_confirmation_required,
    refundValueBasis: row.refund_value_basis
  };

  return {
    id: row.id,
    productType: row.product_type,
    targetId: row.target_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    quote: {
      minimumAmountMinor: Number(row.minimum_amount_minor),
      platformFeeBps: row.platform_fee_bps,
      referralShareOfPlatformFeeBps: row.referral_share_of_platform_fee_bps,
      quotedAt: row.quoted_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      policySource: row.commercial_policy_source,
      policyRevision: row.commercial_policy_revision
    },
    refundPolicy,
    referenceAddress: row.reference_address,
    treasuryWallet: row.treasury_wallet,
    settlementKind: row.settlement_kind ?? "creator_split",
    buyerWallet: row.buyer_wallet,
    creatorWallet: row.creator_wallet ?? row.treasury_wallet,
    enterpriseWallet: row.enterprise_wallet,
    platformFeeWallet: row.platform_fee_wallet ?? row.treasury_wallet,
    referralWallet: row.referral_wallet,
    totalAmountMinor: Number(row.total_amount_minor ?? row.amount_minor),
    creatorSideProceedsMinor: Number(row.creator_side_proceeds_minor ?? row.creator_amount_minor ?? row.amount_minor),
    creatorAmountMinor: Number(row.creator_amount_minor ?? row.amount_minor),
    enterpriseManagementAmountMinor: Number(row.enterprise_management_amount_minor ?? 0),
    platformFeeGrossMinor: Number(row.platform_fee_gross_minor ?? row.platform_fee_amount_minor ?? 0),
    platformFeeAmountMinor: Number(row.platform_fee_amount_minor ?? 0),
    referralAmountMinor: Number(row.referral_amount_minor ?? 0),
    tokenMint: row.token_mint,
    tokenDecimals: row.token_decimals,
    solanaCluster: row.solana_cluster,
    expiresAt: row.expires_at,
    quotedAt: row.quoted_at,
    minimumAmountMinor: Number(row.minimum_amount_minor),
    platformFeeBps: row.platform_fee_bps,
    referralShareOfPlatformFeeBps: row.referral_share_of_platform_fee_bps,
    commercialPolicySource: row.commercial_policy_source,
    commercialPolicyRevision: row.commercial_policy_revision,
    requestHash: row.request_hash,
    withdrawalWaiverRequired: row.withdrawal_waiver_required,
    withdrawalWaiverAcceptedAt: row.withdrawal_waiver_accepted_at,
    withdrawalWaiverVersion: row.withdrawal_waiver_version,
    termsVersion: row.terms_version,
    durableConfirmationRequired: row.durable_confirmation_required,
    refundValueBasis: row.refund_value_basis
  };
}
