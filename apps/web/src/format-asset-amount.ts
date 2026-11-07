import {
  formatAtomicAssetAmount,
  formatAtomicAssetInputValue as formatAtomicAssetInputValueShared,
  formatScaledInteger,
  paymentAssetAtomicDecimals,
  type PaymentAssetCurrency
} from "@veel/config/asset-amount";

export type AssetCurrency = PaymentAssetCurrency;
export { formatAtomicAssetAmount };

const MAX_SAFE_CONTRACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

type AtomicRange = {
  minimumAtomic?: bigint;
  maximumAtomic?: bigint;
};

type TwoDecimalMinorRange = {
  minimumMinor?: bigint;
  maximumMinor?: bigint;
};

declare const atomicContractNumberBrand: unique symbol;
declare const twoDecimalMinorContractNumberBrand: unique symbol;

/** A JSON-safe integer whose unit is the selected asset's atomic unit. */
export type AtomicAssetContractNumber = number & {
  readonly [atomicContractNumberBrand]: true;
};

/** A JSON-safe integer whose unit is one hundredth of the displayed currency. */
export type TwoDecimalMinorContractNumber = number & {
  readonly [twoDecimalMinorContractNumberBrand]: true;
};

export class AssetAmountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetAmountInputError";
  }
}

export function formatAtomicAssetInputValue(
  amountAtomic: number | string | bigint,
  currency: AssetCurrency
): string {
  return formatAtomicAssetInputValueShared(amountAtomic, currency);
}

export function formatTwoDecimalMinorAmount(
  amountMinor: number | string | bigint,
  currency: string
): string {
  return `${formatScaledInteger(amountMinor, 2, true, false)} ${currency}`;
}

export function formatTwoDecimalMinorInputValue(
  amountMinor: number | string | bigint
): string {
  return formatScaledInteger(amountMinor, 2, false, false);
}

export function parseAssetAmountToAtomic(
  input: string,
  currency: AssetCurrency,
  range: AtomicRange = {}
): bigint {
  return parseDecimalToScaledInteger(input, paymentAssetAtomicDecimals[currency], {
    minimum: range.minimumAtomic ?? 0n,
    maximum: range.maximumAtomic ?? MAX_SAFE_CONTRACT_INTEGER,
    unitLabel: `${currency} atomic amount`
  });
}

export function parseAssetAmountToAtomicContractNumber(
  input: string,
  currency: AssetCurrency,
  range: AtomicRange = {}
): AtomicAssetContractNumber {
  return Number(parseAssetAmountToAtomic(input, currency, range)) as AtomicAssetContractNumber;
}

export function parseTwoDecimalAmountToMinor(
  input: string,
  range: TwoDecimalMinorRange = {}
): bigint {
  return parseDecimalToScaledInteger(input, 2, {
    minimum: range.minimumMinor ?? 0n,
    maximum: range.maximumMinor ?? MAX_SAFE_CONTRACT_INTEGER,
    unitLabel: "two-decimal minor amount"
  });
}

export function parseTwoDecimalAmountToMinorContractNumber(
  input: string,
  range: TwoDecimalMinorRange = {}
): TwoDecimalMinorContractNumber {
  return Number(parseTwoDecimalAmountToMinor(input, range)) as TwoDecimalMinorContractNumber;
}

function parseDecimalToScaledInteger(
  input: string,
  decimals: number,
  range: { minimum: bigint; maximum: bigint; unitLabel: string }
): bigint {
  if (range.minimum < 0n || range.maximum < range.minimum || range.maximum > MAX_SAFE_CONTRACT_INTEGER) {
    throw new RangeError("The amount range must fit in a non-negative JSON safe integer.");
  }

  if (input.length === 0) {
    throw new AssetAmountInputError("Enter an amount.");
  }

  if (input.length > 32 || input.trim() !== input) {
    throw new AssetAmountInputError("Enter a plain decimal amount without spaces.");
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(input);
  if (!match) {
    throw new AssetAmountInputError("Enter a plain non-negative decimal amount.");
  }

  const fractionalDigits = match[2] ?? "";
  if (fractionalDigits.length > decimals) {
    throw new AssetAmountInputError(
      `Enter no more than ${decimals} decimal places for this amount.`
    );
  }

  const factor = 10n ** BigInt(decimals);
  const whole = BigInt(match[1]!);
  const fraction = BigInt(fractionalDigits.padEnd(decimals, "0") || "0");
  const scaled = whole * factor + fraction;

  if (scaled < range.minimum || scaled > range.maximum) {
    throw new AssetAmountInputError(`The ${range.unitLabel} is outside the allowed range.`);
  }

  return scaled;
}
