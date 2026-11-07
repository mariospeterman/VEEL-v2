export const paymentSubmissionRecoveryPrefix = "wevid:payment-submission:v1:";

export interface PaymentSubmissionBrowserScope {
  actorUserId: string;
  clientSessionScope: string;
  recoveryScope: string;
}

export interface PaymentSubmissionQuoteSnapshot {
  productType:
    | "tip"
    | "support"
    | "content_unlock"
    | "paid_message"
    | "live_pass"
    | "event_access_pass"
    | "creator_subscription"
    | "platform_subscription";
  amountMinor: number;
  currency: "SOL" | "USDC";
  settlementKind: "creator_split" | "platform_owned" | "dev_test";
  creatorSideProceedsMinor: number;
  creatorAmountMinor: number;
  enterpriseManagementAmountMinor: number;
  platformFeeGrossMinor: number;
  platformFeeAmountMinor: number;
  referralAmountMinor: number;
  minimumAmountMinor: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps: number;
  quotedAt: string;
  expiresAt: string;
  policySource: "environment_default" | "admin_override" | "legacy_environment_default";
  policyRevision: number;
  termsVersion: string;
  withdrawalWaiverVersion: string;
}

export interface PendingPaymentSubmission extends PaymentSubmissionBrowserScope {
  schemaVersion: 1;
  intentId: string;
  walletAddress: string;
  quote: PaymentSubmissionQuoteSnapshot;
  signature: string;
  signedTransactionBase64: string;
  idempotencyKey: string;
  intentExpiresAt: string;
  createdAt: string;
}

export interface PaymentRecoveryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PaymentSubmissionRecoveryDisposition = "blocked" | "invalid" | "retry";

export function paymentSubmissionRecoveryKey(scope: PaymentSubmissionBrowserScope): string {
  return `${paymentSubmissionRecoveryPrefix}${scope.actorUserId}:${scope.clientSessionScope}:${encodeURIComponent(scope.recoveryScope)}`;
}

export function readPendingPaymentSubmission(
  storage: PaymentRecoveryStorage,
  scope: PaymentSubmissionBrowserScope
): PendingPaymentSubmission | null {
  const key = paymentSubmissionRecoveryKey(scope);
  const serialized = storage.getItem(key);
  if (!serialized) return null;

  const record = parsePendingPaymentSubmission(serialized);
  if (!record || !sameBrowserScope(record, scope)) {
    storage.removeItem(key);
    return null;
  }

  return record;
}

export function storePendingPaymentSubmission(
  storage: PaymentRecoveryStorage,
  candidate: PendingPaymentSubmission
): { record: PendingPaymentSubmission; storedNew: boolean } {
  if (!isPendingPaymentSubmission(candidate)) {
    throw new Error("Payment recovery record is invalid");
  }

  const existing = readPendingPaymentSubmission(storage, candidate);
  if (existing) return { record: existing, storedNew: false };

  const key = paymentSubmissionRecoveryKey(candidate);
  storage.setItem(key, JSON.stringify(candidate));

  // Re-read after the synchronous write. Another tab holding the same browser lock may have
  // completed first; callers must always recover the record that actually owns the scope.
  const stored = readPendingPaymentSubmission(storage, candidate);
  if (!stored) throw new Error("Payment recovery record could not be retained");
  return {
    record: stored,
    storedNew: sameSignedSubmission(stored, candidate)
  };
}

export function removePendingPaymentSubmission(
  storage: PaymentRecoveryStorage,
  scope: PaymentSubmissionBrowserScope,
  expected?: Pick<PendingPaymentSubmission, "intentId" | "signature">
): void {
  if (expected) {
    const current = readPendingPaymentSubmission(storage, scope);
    if (
      !current ||
      current.intentId !== expected.intentId ||
      current.signature !== expected.signature
    ) {
      return;
    }
  }

  storage.removeItem(paymentSubmissionRecoveryKey(scope));
}

export function applyPaymentSubmissionDeliveryResult(
  storage: PaymentRecoveryStorage,
  record: PendingPaymentSubmission,
  result: "accepted" | "accepted_expired" | "blocked" | "invalid" | "uncertain"
): PaymentSubmissionRecoveryDisposition {
  if (result === "invalid") {
    removePendingPaymentSubmission(storage, record, {
      intentId: record.intentId,
      signature: record.signature
    });
    return "invalid";
  }

  return result === "blocked" ? "blocked" : "retry";
}

export function clearPaymentSubmissionRecovery(storage: PaymentRecoveryStorage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(paymentSubmissionRecoveryPrefix)) storage.removeItem(key);
  }
}

function parsePendingPaymentSubmission(value: string): PendingPaymentSubmission | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPendingPaymentSubmission(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPendingPaymentSubmission(value: unknown): value is PendingPaymentSubmission {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;

  return (
    isUuid(value.actorUserId) &&
    typeof value.clientSessionScope === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value.clientSessionScope) &&
    isBoundedString(value.recoveryScope, 1, 256) &&
    isUuid(value.intentId) &&
    typeof value.walletAddress === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.walletAddress) &&
    isPaymentQuoteSnapshot(value.quote, value.intentExpiresAt) &&
    typeof value.signature === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(value.signature) &&
    typeof value.signedTransactionBase64 === "string" &&
    value.signedTransactionBase64.length > 0 &&
    value.signedTransactionBase64.length <= 4_096 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.signedTransactionBase64
    ) &&
    isBoundedString(value.idempotencyKey, 8, 200) &&
    isIsoDate(value.intentExpiresAt) &&
    isIsoDate(value.createdAt)
  );
}

function isPaymentQuoteSnapshot(
  value: unknown,
  intentExpiresAt: unknown
): value is PaymentSubmissionQuoteSnapshot {
  if (!isRecord(value)) return false;

  const productTypes: PaymentSubmissionQuoteSnapshot["productType"][] = [
    "tip",
    "support",
    "content_unlock",
    "paid_message",
    "live_pass",
    "event_access_pass",
    "creator_subscription",
    "platform_subscription"
  ];
  const settlementKinds: PaymentSubmissionQuoteSnapshot["settlementKind"][] = [
    "creator_split",
    "platform_owned",
    "dev_test"
  ];
  const policySources: PaymentSubmissionQuoteSnapshot["policySource"][] = [
    "environment_default",
    "admin_override",
    "legacy_environment_default"
  ];
  const productType = value.productType;
  const currency = value.currency;
  const settlementKind = value.settlementKind;
  const policySource = value.policySource;

  if (
    typeof productType !== "string" ||
    !productTypes.includes(productType as PaymentSubmissionQuoteSnapshot["productType"]) ||
    (currency !== "SOL" && currency !== "USDC") ||
    typeof settlementKind !== "string" ||
    !settlementKinds.includes(settlementKind as PaymentSubmissionQuoteSnapshot["settlementKind"]) ||
    typeof policySource !== "string" ||
    !policySources.includes(policySource as PaymentSubmissionQuoteSnapshot["policySource"]) ||
    !isSafeInteger(value.amountMinor, 1) ||
    !isSafeInteger(value.creatorSideProceedsMinor, 1) ||
    !isSafeInteger(value.creatorAmountMinor, 1) ||
    !isSafeInteger(value.enterpriseManagementAmountMinor, 0) ||
    !isSafeInteger(value.platformFeeGrossMinor, 0) ||
    !isSafeInteger(value.platformFeeAmountMinor, 0) ||
    !isSafeInteger(value.referralAmountMinor, 0) ||
    !isSafeInteger(value.minimumAmountMinor, 1) ||
    !isSafeInteger(value.platformFeeBps, 0, 9_999) ||
    !isSafeInteger(value.referralShareOfPlatformFeeBps, 0, 10_000) ||
    !isSafeInteger(value.policyRevision, 0) ||
    !isIsoDate(value.quotedAt) ||
    !isIsoDate(value.expiresAt) ||
    value.expiresAt !== intentExpiresAt ||
    !isBoundedString(value.termsVersion, 1, 80) ||
    !isBoundedString(value.withdrawalWaiverVersion, 1, 80)
  ) {
    return false;
  }

  return (
    value.creatorAmountMinor + value.enterpriseManagementAmountMinor ===
      value.creatorSideProceedsMinor &&
    value.platformFeeAmountMinor + value.referralAmountMinor === value.platformFeeGrossMinor &&
    value.creatorSideProceedsMinor + value.platformFeeGrossMinor === value.amountMinor
  );
}

function sameBrowserScope(
  left: PaymentSubmissionBrowserScope,
  right: PaymentSubmissionBrowserScope
): boolean {
  return (
    left.actorUserId === right.actorUserId &&
    left.clientSessionScope === right.clientSessionScope &&
    left.recoveryScope === right.recoveryScope
  );
}

function sameSignedSubmission(
  left: PendingPaymentSubmission,
  right: PendingPaymentSubmission
): boolean {
  return (
    sameBrowserScope(left, right) &&
    left.intentId === right.intentId &&
    left.walletAddress === right.walletAddress &&
    left.signature === right.signature &&
    left.signedTransactionBase64 === right.signedTransactionBase64 &&
    left.idempotencyKey === right.idempotencyKey
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isSafeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
