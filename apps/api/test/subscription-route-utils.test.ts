import { describe, expect, it } from "vitest";
import {
  recurringSubscriptionTermsVersion,
  recurringSubscriptionWithdrawalWaiverVersion,
  validateCreateSubscriptionIntent
} from "../src/modules/subscription/subscription-route-utils";

describe("validateCreateSubscriptionIntent", () => {
  const accepted = {
    planId: "platform_plus_monthly",
    termsVersion: recurringSubscriptionTermsVersion,
    withdrawalWaiverVersion: recurringSubscriptionWithdrawalWaiverVersion,
    immediateAccessAcknowledged: true
  } as const;
  const validateInvalid = (body: Record<string, unknown>) =>
    validateCreateSubscriptionIntent(
      body as unknown as Parameters<typeof validateCreateSubscriptionIntent>[0]
    );

  it("requires the exact current recurring terms and explicit immediate-access acknowledgement", () => {
    expect(validateCreateSubscriptionIntent(accepted)).toBeNull();
    expect(validateInvalid({
      ...accepted,
      termsVersion: "subscription-recurring-terms-stale"
    })).toBe("termsVersion is not current");
    expect(validateInvalid({
      ...accepted,
      immediateAccessAcknowledged: false
    })).toBe("immediateAccessAcknowledged must be true");
  });
});
