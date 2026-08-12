import { describe, expect, it } from "vitest";
import { formatAssetAmount } from "../src/format-asset-amount";

describe("formatAssetAmount", () => {
  it("formats SOL and USDC from exact atomic units", () => {
    expect(formatAssetAmount(50_000_000, "SOL")).toBe("0.05 SOL");
    expect(formatAssetAmount(500_000, "USDC")).toBe("0.5 USDC");
    expect(formatAssetAmount("9007199254740991", "USDC")).toBe(
      "9,007,199,254.740991 USDC"
    );
  });
});

