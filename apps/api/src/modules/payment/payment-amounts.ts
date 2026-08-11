export type SettlementKind = "creator_split" | "platform_owned" | "dev_test";

export interface PaymentSplitInput {
  totalAmountAtomic: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps?: number | null;
}

export interface PaymentSplit {
  totalAmountAtomic: number;
  creatorAmountAtomic: number;
  platformFeeAmountAtomic: number;
  allocationAmountAtomic: number;
}

export class PaymentAmountError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PaymentAmountError";
  }
}

export function calculateCreatorSplit(input: PaymentSplitInput): PaymentSplit {
  assertSafeAtomicAmount(input.totalAmountAtomic, "invalid_total");
  assertSafeBasisPoints(input.platformFeeBps);
  const referralShareOfPlatformFeeBps = input.referralShareOfPlatformFeeBps ?? 0;
  assertSafeBasisPoints(referralShareOfPlatformFeeBps);

  const total = BigInt(input.totalAmountAtomic);
  const platformFeeGross = (total * BigInt(input.platformFeeBps)) / 10_000n;
  const allocation =
    (platformFeeGross * BigInt(referralShareOfPlatformFeeBps)) / 10_000n;
  const platformFeeNet = platformFeeGross - allocation;

  if (platformFeeGross > total) {
    throw new PaymentAmountError("fee_greater_than_total");
  }

  const creator = total - platformFeeGross;

  if (creator <= 0n) {
    throw new PaymentAmountError("creator_amount_not_positive");
  }

  return {
    totalAmountAtomic: Number(total),
    creatorAmountAtomic: Number(creator),
    platformFeeAmountAtomic: Number(platformFeeNet),
    allocationAmountAtomic: Number(allocation)
  };
}

function assertSafeAtomicAmount(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PaymentAmountError(code);
  }
}

function assertSafeBasisPoints(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new PaymentAmountError("invalid_fee_bps");
  }
}
