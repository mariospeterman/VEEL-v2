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
  platform_fee_wallet: string | null;
  allocation_wallet: string | null;
  total_amount_minor: number | null;
  creator_amount_minor: number | null;
  platform_fee_amount_minor: number | null;
  allocation_amount_minor: number | null;
  solana_cluster: StoredPaymentIntent["solanaCluster"];
  expires_at: Date;
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
    refundPolicy,
    referenceAddress: row.reference_address,
    treasuryWallet: row.treasury_wallet,
    settlementKind: row.settlement_kind ?? "creator_split",
    buyerWallet: row.buyer_wallet,
    creatorWallet: row.creator_wallet ?? row.treasury_wallet,
    platformFeeWallet: row.platform_fee_wallet ?? row.treasury_wallet,
    allocationWallet: row.allocation_wallet,
    totalAmountMinor: Number(row.total_amount_minor ?? row.amount_minor),
    creatorAmountMinor: Number(row.creator_amount_minor ?? row.amount_minor),
    platformFeeAmountMinor: Number(row.platform_fee_amount_minor ?? 0),
    allocationAmountMinor: Number(row.allocation_amount_minor ?? 0),
    solanaCluster: row.solana_cluster,
    expiresAt: row.expires_at,
    requestHash: row.request_hash,
    withdrawalWaiverRequired: row.withdrawal_waiver_required,
    withdrawalWaiverAcceptedAt: row.withdrawal_waiver_accepted_at,
    withdrawalWaiverVersion: row.withdrawal_waiver_version,
    termsVersion: row.terms_version,
    durableConfirmationRequired: row.durable_confirmation_required,
    refundValueBasis: row.refund_value_basis
  };
}
