import { describe, expect, it } from "vitest";
import {
  formatCommercialSolAmountInput,
  parseOptionalCommercialSolAmount,
  parseRequiredCommercialSolAmount
} from "../src/commercial-amount-input";
import {
  formatSubscriptionPriceInput,
  isValidSubscriptionPriceInput,
  parseSubscriptionPriceInput
} from "../src/subscription-price-input";

describe("commercial SOL contract mapping", () => {
  it("maps human SOL input to atomic contract integers", () => {
    expect(parseRequiredCommercialSolAmount("1")).toBe(1_000_000_000);
    expect(parseRequiredCommercialSolAmount("0.000000001")).toBe(1);
    expect(parseOptionalCommercialSolAmount("")).toBeNull();
    expect(parseOptionalCommercialSolAmount("0.5")).toBe(500_000_000);
  });

  it("formats stored atomic values for form review", () => {
    expect(formatCommercialSolAmountInput(1_000_000_000)).toBe("1");
    expect(formatCommercialSolAmountInput(1)).toBe("0.000000001");
  });

  it("does not accept zero, excess precision, or unsafe contract integers", () => {
    expect(() => parseRequiredCommercialSolAmount("0")).toThrow();
    expect(() => parseRequiredCommercialSolAmount("0.0000000001")).toThrow();
    expect(() => parseRequiredCommercialSolAmount("9007199.254740992")).toThrow();
  });
});

describe("subscription price contract mapping", () => {
  it("maps display prices to two-decimal minor integers", () => {
    expect(parseSubscriptionPriceInput("5")).toBe(500);
    expect(parseSubscriptionPriceInput("10.25")).toBe(1_025);
    expect(formatSubscriptionPriceInput(500)).toBe("5.00");
  });

  it("enforces the backend membership range and exact cents", () => {
    expect(isValidSubscriptionPriceInput("1.00")).toBe(true);
    expect(isValidSubscriptionPriceInput("1000.00")).toBe(true);
    expect(isValidSubscriptionPriceInput("0.99")).toBe(false);
    expect(isValidSubscriptionPriceInput("1000.01")).toBe(false);
    expect(isValidSubscriptionPriceInput("5.001")).toBe(false);
  });
});
