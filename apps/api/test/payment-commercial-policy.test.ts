import { parseServerEnv } from "@veel/config";
import { describe, expect, it } from "vitest";
import { defaultPaymentCommercialPolicy } from "../src/modules/payment/payment-commercial-policy.js";

describe("default payment commercial policy", () => {
  it("resolves product- and asset-specific floors with a backend quote window", () => {
    const config = parseServerEnv({
      PAYMENT_MIN_SUPPORT_SOL_LAMPORTS: "11",
      PAYMENT_MIN_SUPPORT_USDC_ATOMIC: "12",
      PAYMENT_MIN_CONTENT_UNLOCK_SOL_LAMPORTS: "21",
      PAYMENT_MIN_CONTENT_UNLOCK_USDC_ATOMIC: "22",
      PAYMENT_MIN_PAID_MESSAGE_SOL_LAMPORTS: "31",
      PAYMENT_MIN_PAID_MESSAGE_USDC_ATOMIC: "32",
      PAYMENT_MIN_LIVE_PASS_SOL_LAMPORTS: "41",
      PAYMENT_MIN_LIVE_PASS_USDC_ATOMIC: "42",
      PAYMENT_MIN_EVENT_ACCESS_PASS_SOL_LAMPORTS: "51",
      PAYMENT_MIN_EVENT_ACCESS_PASS_USDC_ATOMIC: "52",
      PAYMENT_PLATFORM_FEE_BPS: "1250",
      PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS: "1750",
      PAYMENT_QUOTE_TTL_SECONDS: "120"
    });
    const quotedAt = new Date("2026-08-17T01:00:00.000Z");

    expect(defaultPaymentCommercialPolicy(config, "support", "SOL", quotedAt)).toMatchObject({
      minimumAmountMinor: 11,
      platformFeeBps: 1250,
      referralShareOfPlatformFeeBps: 1750,
      quotedAt,
      expiresAt: new Date("2026-08-17T01:02:00.000Z")
    });
    expect(defaultPaymentCommercialPolicy(config, "support", "USDC", quotedAt).minimumAmountMinor).toBe(12);
    expect(defaultPaymentCommercialPolicy(config, "content_unlock", "SOL", quotedAt).minimumAmountMinor).toBe(21);
    expect(defaultPaymentCommercialPolicy(config, "content_unlock", "USDC", quotedAt).minimumAmountMinor).toBe(22);
    expect(defaultPaymentCommercialPolicy(config, "paid_message", "SOL", quotedAt).minimumAmountMinor).toBe(31);
    expect(defaultPaymentCommercialPolicy(config, "paid_message", "USDC", quotedAt).minimumAmountMinor).toBe(32);
    expect(defaultPaymentCommercialPolicy(config, "live_pass", "SOL", quotedAt).minimumAmountMinor).toBe(41);
    expect(defaultPaymentCommercialPolicy(config, "live_pass", "USDC", quotedAt).minimumAmountMinor).toBe(42);
    expect(defaultPaymentCommercialPolicy(config, "event_access_pass", "SOL", quotedAt).minimumAmountMinor).toBe(51);
    expect(defaultPaymentCommercialPolicy(config, "event_access_pass", "USDC", quotedAt).minimumAmountMinor).toBe(52);
  });
});
