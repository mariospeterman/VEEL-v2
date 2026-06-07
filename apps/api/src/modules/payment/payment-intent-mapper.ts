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
}

export function toStoredPaymentIntent(row: PaymentIntentRow): StoredPaymentIntent {
  return {
    id: row.id,
    productType: row.product_type,
    targetId: row.target_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    referenceAddress: row.reference_address,
    treasuryWallet: row.treasury_wallet,
    solanaCluster: row.solana_cluster,
    expiresAt: row.expires_at,
    requestHash: row.request_hash
  };
}
