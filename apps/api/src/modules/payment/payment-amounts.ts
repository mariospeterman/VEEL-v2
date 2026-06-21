export type SettlementKind = "creator_split" | "platform_owned" | "dev_test";

export interface PaymentSplitInput {
  totalAmountAtomic: number;
  platformFeeBps: number;
  allocationAmountAtomic?: number | null;
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

  const allocationAmountAtomic = input.allocationAmountAtomic ?? 0;
  assertSafeNonNegativeAtomicAmount(allocationAmountAtomic, "invalid_allocation");

  const total = BigInt(input.totalAmountAtomic);
  const platformFee = (total * BigInt(input.platformFeeBps)) / 10_000n;
  const allocation = BigInt(allocationAmountAtomic);

  if (platformFee > total) {
    throw new PaymentAmountError("fee_greater_than_total");
  }

  if (platformFee + allocation > total) {
    throw new PaymentAmountError("split_greater_than_total");
  }

  const creator = total - platformFee - allocation;

  if (creator <= 0n) {
    throw new PaymentAmountError("creator_amount_not_positive");
  }

  return {
    totalAmountAtomic: Number(total),
    creatorAmountAtomic: Number(creator),
    platformFeeAmountAtomic: Number(platformFee),
    allocationAmountAtomic: Number(allocation)
  };
}

function assertSafeAtomicAmount(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PaymentAmountError(code);
  }
}

function assertSafeNonNegativeAtomicAmount(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PaymentAmountError(code);
  }
}

function assertSafeBasisPoints(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new PaymentAmountError("invalid_fee_bps");
  }
}
