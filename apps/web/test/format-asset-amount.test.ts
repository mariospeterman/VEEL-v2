import { describe, expect, it } from "vitest";
import {
  AssetAmountInputError,
  formatAtomicAssetAmount,
  formatAtomicAssetInputValue,
  formatTwoDecimalMinorAmount,
  parseAssetAmountToAtomic,
  parseAssetAmountToAtomicContractNumber,
  parseTwoDecimalAmountToMinor
} from "../src/format-asset-amount";

describe("atomic asset amounts", () => {
  it("formats SOL and USDC from exact atomic units", () => {
    expect(formatAtomicAssetAmount(1_000_000_000, "SOL")).toBe("1 SOL");
    expect(formatAtomicAssetAmount(50_000_000, "SOL")).toBe("0.05 SOL");
    expect(formatAtomicAssetAmount(500_000, "USDC")).toBe("0.5 USDC");
    expect(formatAtomicAssetAmount("9007199254740991", "USDC")).toBe(
      "9,007,199,254.740991 USDC"
    );
    expect(formatAtomicAssetInputValue(1_230_000_000, "SOL")).toBe("1.23");
  });

  it("parses decimal strings to exact atomic bigint values", () => {
    expect(parseAssetAmountToAtomic("1", "SOL")).toBe(1_000_000_000n);
    expect(parseAssetAmountToAtomic("0.000000001", "SOL")).toBe(1n);
    expect(parseAssetAmountToAtomic("1.23", "USDC")).toBe(1_230_000n);
    expect(parseAssetAmountToAtomic("0.000001", "USDC")).toBe(1n);
  });

  it("preserves the JSON-safe precision boundary at contract mapping", () => {
    expect(parseAssetAmountToAtomic("9007199.254740991", "SOL")).toBe(
      BigInt(Number.MAX_SAFE_INTEGER)
    );
    expect(parseAssetAmountToAtomicContractNumber("9007199.254740991", "SOL")).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(() => parseAssetAmountToAtomic("9007199.254740992", "SOL")).toThrow(
      AssetAmountInputError
    );
  });

  it.each([
    ["", "SOL"],
    [" 1", "SOL"],
    ["1 ", "SOL"],
    ["+1", "SOL"],
    ["-1", "SOL"],
    ["01", "SOL"],
    ["1e2", "SOL"],
    ["NaN", "SOL"],
    ["Infinity", "SOL"],
    ["1.0000000001", "SOL"],
    ["0.0000001", "USDC"]
  ] as const)("rejects invalid or over-precise value %s", (value, currency) => {
    expect(() => parseAssetAmountToAtomic(value, currency)).toThrow(AssetAmountInputError);
  });

  it("enforces an explicit minimum atomic range", () => {
    expect(() =>
      parseAssetAmountToAtomic("0", "SOL", { minimumAtomic: 1n })
    ).toThrow(AssetAmountInputError);
  });

  it("rejects imprecise numeric formatter inputs", () => {
    expect(() => formatAtomicAssetAmount(Number.MAX_SAFE_INTEGER + 1, "SOL")).toThrow(
      RangeError
    );
  });
});

describe("two-decimal minor amounts", () => {
  it("formats cents independently from token atomic units", () => {
    expect(formatTwoDecimalMinorAmount(500, "USDC")).toBe("5.00 USDC");
    expect(formatTwoDecimalMinorAmount(1_050, "USDC")).toBe("10.50 USDC");
    expect(formatTwoDecimalMinorAmount(100_005, "USD")).toBe("1,000.05 USD");
  });

  it("parses two-decimal input without floating point", () => {
    expect(parseTwoDecimalAmountToMinor("5")).toBe(500n);
    expect(parseTwoDecimalAmountToMinor("5.01")).toBe(501n);
    expect(parseTwoDecimalAmountToMinor("0.01")).toBe(1n);
    expect(() => parseTwoDecimalAmountToMinor("5.001")).toThrow(AssetAmountInputError);
  });
});
