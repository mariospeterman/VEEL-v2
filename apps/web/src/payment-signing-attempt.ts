export type PaymentSigningAttemptResult =
  | "retained_current"
  | "retained_stale"
  | "stale_before_approval";

const signingCapabilityIds = new WeakMap<object, number>();
let nextSigningCapabilityId = 1;

export function runWithExclusivePaymentSigningOwnership<T>(
  ownershipKey: string,
  work: () => Promise<T>,
  lockManager: LockManager | null | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.locks
): Promise<T> {
  if (!lockManager?.request) {
    return Promise.reject(new Error("Safe cross-tab wallet approval ownership is unavailable"));
  }

  return lockManager.request(
    `wevid-payment:${ownershipKey}`,
    { mode: "exclusive" },
    work
  ).then((result) => result);
}

export function paymentSigningAttemptIdentity(input: {
  checkoutUrl: string;
  expiresAt: string;
  intentId: string;
  qrDataUrl: string;
  recoveryScope: string;
  retryVersion: number;
  signingCapability: unknown;
  transactionRequestUrl: string;
  walletAdapterName: string | null;
  walletAddress: string | null;
}): string {
  return JSON.stringify([
    input.intentId,
    input.recoveryScope,
    input.retryVersion,
    input.walletAdapterName ?? "wallet-unselected",
    input.walletAddress,
    signingCapabilityIdentity(input.signingCapability),
    input.transactionRequestUrl,
    input.checkoutUrl,
    input.expiresAt,
    input.qrDataUrl
  ]);
}

/**
 * Preparation is abortable and fenced before the wallet prompt. Wallet approval itself is not
 * abortable; once approved, the exact result is retained synchronously before any stale UI callback
 * is suppressed.
 */
export async function runFencedPaymentSigningApproval<
  TPrepared,
  TApproved,
  TRetained
>(input: {
  approve: (prepared: TPrepared) => Promise<TApproved>;
  isCurrent: () => boolean;
  onRetained: (retained: TRetained) => void;
  prepare: (signal: AbortSignal) => Promise<TPrepared>;
  retain: (approved: TApproved) => TRetained;
  signal: AbortSignal;
}): Promise<PaymentSigningAttemptResult> {
  const prepared = await input.prepare(input.signal);
  if (input.signal.aborted || !input.isCurrent()) return "stale_before_approval";

  const approved = await input.approve(prepared);
  const retained = input.retain(approved);
  if (input.signal.aborted || !input.isCurrent()) return "retained_stale";

  input.onRetained(retained);
  return "retained_current";
}

function signingCapabilityIdentity(capability: unknown): string {
  if (typeof capability !== "function") return "signing-unavailable";
  const key = capability as object;
  const existing = signingCapabilityIds.get(key);
  if (existing) return `signing-${existing}`;
  const identity = nextSigningCapabilityId;
  nextSigningCapabilityId += 1;
  signingCapabilityIds.set(key, identity);
  return `signing-${identity}`;
}
