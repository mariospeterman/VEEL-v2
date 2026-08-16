export type SettlementKind = "creator_split" | "platform_owned" | "dev_test";

export interface PaymentSplitInput {
  totalAmountAtomic: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps?: number | null;
  enterpriseShareOfCreatorProceedsBps?: number | null;
}

export interface PaymentSplit {
  totalAmountAtomic: number;
  creatorSideProceedsAtomic: number;
  creatorAmountAtomic: number;
  enterpriseManagementAmountAtomic: number;
  platformFeeGrossAtomic: number;
  platformFeeAmountAtomic: number;
  referralAmountAtomic: number;
}

export interface SettlementAmountVector {
  totalAmountMinor: number;
  creatorAmountMinor: number;
  enterpriseManagementAmountMinor: number;
  platformFeeAmountMinor: number;
  referralAmountMinor: number;
}

export class PaymentAmountError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PaymentAmountError";
  }
}

export function calculateSettlementSplit(input: PaymentSplitInput): PaymentSplit {
  assertSafeAtomicAmount(input.totalAmountAtomic, "invalid_total");
  assertSafeBasisPoints(input.platformFeeBps);
  const referralShareOfPlatformFeeBps = input.referralShareOfPlatformFeeBps ?? 0;
  const enterpriseShareOfCreatorProceedsBps = input.enterpriseShareOfCreatorProceedsBps ?? 0;
  assertSafeBasisPoints(referralShareOfPlatformFeeBps);
  assertSafeBasisPoints(enterpriseShareOfCreatorProceedsBps);

  const total = BigInt(input.totalAmountAtomic);
  const platformFeeGross = (total * BigInt(input.platformFeeBps)) / 10_000n;
  const referral =
    (platformFeeGross * BigInt(referralShareOfPlatformFeeBps)) / 10_000n;
  const platformFeeNet = platformFeeGross - referral;

  if (platformFeeGross > total) {
    throw new PaymentAmountError("fee_greater_than_total");
  }

  const creatorSideProceeds = total - platformFeeGross;
  const enterpriseManagement =
    (creatorSideProceeds * BigInt(enterpriseShareOfCreatorProceedsBps)) / 10_000n;
  const creator = creatorSideProceeds - enterpriseManagement;

  if (creator <= 0n) {
    throw new PaymentAmountError("creator_amount_not_positive");
  }

  return {
    totalAmountAtomic: Number(total),
    creatorSideProceedsAtomic: Number(creatorSideProceeds),
    creatorAmountAtomic: Number(creator),
    enterpriseManagementAmountAtomic: Number(enterpriseManagement),
    platformFeeGrossAtomic: Number(platformFeeGross),
    platformFeeAmountAtomic: Number(platformFeeNet),
    referralAmountAtomic: Number(referral)
  };
}

export function hasSafeSettlementAmounts(input: SettlementAmountVector): boolean {
  if (
    !isSafeAtomicAmount(input.totalAmountMinor, false) ||
    !isSafeAtomicAmount(input.creatorAmountMinor, false) ||
    !isSafeAtomicAmount(input.enterpriseManagementAmountMinor, true) ||
    !isSafeAtomicAmount(input.platformFeeAmountMinor, true) ||
    !isSafeAtomicAmount(input.referralAmountMinor, true)
  ) {
    return false;
  }

  return BigInt(input.totalAmountMinor) ===
    BigInt(input.creatorAmountMinor) +
      BigInt(input.enterpriseManagementAmountMinor) +
      BigInt(input.platformFeeAmountMinor) +
      BigInt(input.referralAmountMinor);
}

function assertSafeAtomicAmount(value: number, code: string): void {
  if (!isSafeAtomicAmount(value, false)) {
    throw new PaymentAmountError(code);
  }
}

function isSafeAtomicAmount(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function assertSafeBasisPoints(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new PaymentAmountError("invalid_fee_bps");
  }
}
