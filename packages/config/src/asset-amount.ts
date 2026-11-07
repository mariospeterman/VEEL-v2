export const paymentAssetAtomicDecimals = Object.freeze({
  SOL: 9,
  USDC: 6
} as const);

export type PaymentAssetCurrency = keyof typeof paymentAssetAtomicDecimals;
export type ExactAtomicAmount = bigint | number | string;

export function isPaymentAssetCurrency(value: string): value is PaymentAssetCurrency {
  return Object.prototype.hasOwnProperty.call(paymentAssetAtomicDecimals, value);
}

export function formatAtomicAssetAmount(
  amountAtomic: ExactAtomicAmount,
  currency: PaymentAssetCurrency
): string {
  return `${formatScaledInteger(amountAtomic, paymentAssetAtomicDecimals[currency])} ${currency}`;
}

export function formatAtomicAssetInputValue(
  amountAtomic: ExactAtomicAmount,
  currency: PaymentAssetCurrency
): string {
  return formatScaledInteger(amountAtomic, paymentAssetAtomicDecimals[currency], false);
}

export function exactInteger(value: ExactAtomicAmount): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError("Amount numbers must be safe integers.");
    }
    return BigInt(value);
  }

  if (typeof value === "string" && !/^-?(0|[1-9]\d*)$/.test(value)) {
    throw new RangeError("Amount strings must contain an exact base-10 integer.");
  }

  return BigInt(value);
}

export function formatScaledInteger(
  input: ExactAtomicAmount,
  decimals: number,
  groupWhole = true,
  trimFraction = true
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("Asset decimals must be an integer between 0 and 18.");
  }

  const amount = exactInteger(input);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = decimals === 0 ? absolute : absolute / divisor;
  const rawFraction =
    decimals === 0 ? "" : (absolute % divisor).toString().padStart(decimals, "0");
  const fractional = trimFraction ? rawFraction.replace(/0+$/, "") : rawFraction;
  const wholeText = groupWhole
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : whole.toString();

  return `${negative ? "-" : ""}${wholeText}${fractional ? `.${fractional}` : ""}`;
}
