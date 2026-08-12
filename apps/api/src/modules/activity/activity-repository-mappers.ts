import type { AccessPassPage, ActivityItem, ActivityPage, WalletTransaction } from "./types.js";

export interface ActivityRow {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  state: string;
  product_type: ActivityItem["productType"] | null;
  target_id: string | null;
  amount_minor: number | null;
  currency: ActivityItem["currency"] | null;
  payment_intent_id: string | null;
  signature: string | null;
  reference_address: string | null;
  receipt_id: string | null;
  receipt_number: string | null;
  receipt_state: string | null;
  in_app_confirmation_state: string | null;
  email_confirmation_state: string | null;
  withdrawal_right_status: ActivityItem["withdrawalRightStatus"] | null;
  support_review_available: boolean | null;
  latest_refund_request_state: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

export interface WalletTransactionRow {
  id: string;
  chain: WalletTransaction["chain"];
  direction: WalletTransaction["direction"];
  amount_minor: number;
  currency: WalletTransaction["currency"];
  state: WalletTransaction["state"];
  source: WalletTransaction["source"];
  payment_intent_id: string | null;
  wallet_id: string | null;
  signature: string | null;
  reference_address: string | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
}

export interface AccessPassRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  qr_token: string;
  state: AccessPassPage["items"][number]["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

export function toActivityPage(rows: ActivityRow[], limit: number) {
  const pageRows = rows.slice(0, limit);
  const extraRow = rows[limit];

  return {
    items: pageRows.map(toActivityItem),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}

export function normalizeActivityPage(page: ActivityPage): ActivityPage {
  return {
    ...page,
    items: page.items.map((item) => item.productType === "tip"
      ? { ...item, productType: "support", title: item.title === "Tip" ? "Support" : item.title }
      : item)
  };
}

export function toWalletTransaction(row: WalletTransactionRow): WalletTransaction {
  return {
    id: row.id,
    chain: row.chain,
    direction: row.direction,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    source: row.source,
    paymentIntentId: row.payment_intent_id,
    walletId: row.wallet_id,
    signature: row.signature,
    referenceAddress: row.reference_address,
    createdAt: row.created_at.toISOString(),
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null
  };
}

export function toAccessPass(row: AccessPassRow): AccessPassPage["items"][number] {
  return {
    id: row.id,
    eventId: row.event_id,
    accessPassTypeId: row.access_pass_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: row.qr_token,
    checkedInAt: row.checked_in_at ? row.checked_in_at.toISOString() : null,
    createdAt: row.created_at.toISOString()
  };
}

function toActivityItem(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    state: row.state,
    ...(row.product_type ? { productType: row.product_type } : {}),
    targetId: row.target_id,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    ...(row.currency ? { currency: row.currency } : {}),
    paymentIntentId: row.payment_intent_id,
    signature: row.signature,
    referenceAddress: row.reference_address,
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    receiptState: row.receipt_state,
    inAppConfirmationState: row.in_app_confirmation_state,
    emailConfirmationState: row.email_confirmation_state,
    withdrawalRightStatus: row.withdrawal_right_status ?? null,
    supportReviewAvailable: Boolean(row.support_review_available),
    latestRefundRequestState: row.latest_refund_request_state,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null
  };
}
