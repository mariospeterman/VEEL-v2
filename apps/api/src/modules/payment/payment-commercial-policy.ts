import type { ServerEnv } from "@veel/config";
import type { ProductType } from "./types.js";

export type OneTimeCommercialProductType = Exclude<
  ProductType,
  "tip" | "creator_subscription" | "platform_subscription"
>;

export interface DefaultPaymentCommercialPolicy {
  minimumAmountMinor: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps: number;
  quotedAt: Date;
  expiresAt: Date;
}

export function defaultPaymentCommercialPolicy(
  config: ServerEnv,
  productType: OneTimeCommercialProductType,
  currency: "SOL" | "USDC",
  quotedAt = new Date()
): DefaultPaymentCommercialPolicy {
  const minimumAmountMinor = minimumByProduct(config, productType, currency);
  return {
    minimumAmountMinor,
    platformFeeBps: config.PAYMENT_PLATFORM_FEE_BPS,
    referralShareOfPlatformFeeBps: config.PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS,
    quotedAt,
    expiresAt: new Date(quotedAt.getTime() + config.PAYMENT_QUOTE_TTL_SECONDS * 1_000)
  };
}

function minimumByProduct(
  config: ServerEnv,
  productType: OneTimeCommercialProductType,
  currency: "SOL" | "USDC"
): number {
  if (productType === "support") {
    return currency === "USDC"
      ? config.PAYMENT_MIN_SUPPORT_USDC_ATOMIC
      : config.PAYMENT_MIN_SUPPORT_SOL_LAMPORTS;
  }
  if (productType === "content_unlock") {
    return currency === "USDC"
      ? config.PAYMENT_MIN_CONTENT_UNLOCK_USDC_ATOMIC
      : config.PAYMENT_MIN_CONTENT_UNLOCK_SOL_LAMPORTS;
  }
  if (productType === "paid_message") {
    return currency === "USDC"
      ? config.PAYMENT_MIN_PAID_MESSAGE_USDC_ATOMIC
      : config.PAYMENT_MIN_PAID_MESSAGE_SOL_LAMPORTS;
  }
  if (productType === "live_pass") {
    return currency === "USDC"
      ? config.PAYMENT_MIN_LIVE_PASS_USDC_ATOMIC
      : config.PAYMENT_MIN_LIVE_PASS_SOL_LAMPORTS;
  }
  return currency === "USDC"
    ? config.PAYMENT_MIN_EVENT_ACCESS_PASS_USDC_ATOMIC
    : config.PAYMENT_MIN_EVENT_ACCESS_PASS_SOL_LAMPORTS;
}
