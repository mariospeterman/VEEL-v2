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
