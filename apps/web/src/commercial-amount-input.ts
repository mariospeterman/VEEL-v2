import {
  formatAtomicAssetInputValue,
  parseAssetAmountToAtomicContractNumber,
  type AtomicAssetContractNumber
} from "./format-asset-amount";

const MINIMUM_COMMERCIAL_ATOMIC_AMOUNT = 1n;

export function parseRequiredCommercialSolAmount(
  input: string
): AtomicAssetContractNumber {
  return parseAssetAmountToAtomicContractNumber(input, "SOL", {
    minimumAtomic: MINIMUM_COMMERCIAL_ATOMIC_AMOUNT
  });
}

export function parseOptionalCommercialSolAmount(
  input: string
): AtomicAssetContractNumber | null {
  return input === "" ? null : parseRequiredCommercialSolAmount(input);
}

export function formatCommercialSolAmountInput(
  amountAtomic: number | string | bigint
): string {
  return formatAtomicAssetInputValue(amountAtomic, "SOL");
}
