import { describe, expect, it } from "vitest";
import {
  exactInteger,
  formatAtomicAssetAmount,
  formatAtomicAssetInputValue
} from "./asset-amount.js";

describe("asset amount formatting", () => {
  it.each([
    ["1000000000", "SOL", "1 SOL"],
    ["1234567890", "SOL", "1.23456789 SOL"],
    ["9007199254740991", "SOL", "9,007,199.254740991 SOL"],
    ["1000000", "USDC", "1 USDC"],
    ["15000000", "USDC", "15 USDC"],
    ["1234567", "USDC", "1.234567 USDC"],
    ["9007199254740991", "USDC", "9,007,199,254.740991 USDC"],
    ["9007199254740993", "USDC", "9,007,199,254.740993 USDC"]
  ] as const)("formats %s atomic %s exactly", (atomic, currency, expected) => {
    expect(formatAtomicAssetAmount(atomic, currency)).toBe(expected);
  });

  it("keeps ungrouped input values exact", () => {
    expect(formatAtomicAssetInputValue("9007199254740991", "SOL")).toBe(
      "9007199.254740991"
    );
  });

  it("rejects unsafe numeric inputs while accepting the equivalent exact string", () => {
    expect(() => exactInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integers/);
    expect(exactInteger("9007199254740992")).toBe(9007199254740992n);
  });
});
