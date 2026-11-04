import {
  formatTwoDecimalMinorInputValue,
  parseTwoDecimalAmountToMinorContractNumber,
  type TwoDecimalMinorContractNumber
} from "./format-asset-amount";

const MINIMUM_SUBSCRIPTION_PRICE_MINOR = 100n;
const MAXIMUM_SUBSCRIPTION_PRICE_MINOR = 100_000n;

export function parseSubscriptionPriceInput(
  input: string
): TwoDecimalMinorContractNumber {
  return parseTwoDecimalAmountToMinorContractNumber(input, {
    minimumMinor: MINIMUM_SUBSCRIPTION_PRICE_MINOR,
    maximumMinor: MAXIMUM_SUBSCRIPTION_PRICE_MINOR
  });
}

export function formatSubscriptionPriceInput(
  amountMinor: number | string | bigint
): string {
  return formatTwoDecimalMinorInputValue(amountMinor);
}

export function isValidSubscriptionPriceInput(input: string): boolean {
  try {
    parseSubscriptionPriceInput(input);
    return true;
  } catch {
    return false;
  }
}
