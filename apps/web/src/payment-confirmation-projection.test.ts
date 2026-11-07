import { describe, expect, it, vi } from "vitest";
import {
  paymentProjectionCheckoutState,
  refreshPaymentProjection
} from "./payment-confirmation-projection";

describe("payment confirmation projection", () => {
  it("starts projection refresh only for backend-confirmed payment states", () => {
    expect(paymentProjectionCheckoutState("confirmed", true)).toBe("awaiting_projection");
    expect(paymentProjectionCheckoutState("settled", true)).toBe("awaiting_projection");
    expect(paymentProjectionCheckoutState("confirmed", false)).toBe("confirmed");

    for (const state of [
      "created",
      "pending",
      "transaction_requested",
      "submitted",
      "failed",
      "expired",
      "cancelled"
    ]) {
      expect(paymentProjectionCheckoutState(state, true)).toBeNull();
    }
  });

  it("retries the canonical projection immediately and within a fixed bound", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("temporary refresh failure"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(refreshPaymentProjection(refresh, { attempts: 3, wait })).resolves.toBe("exhausted");
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when the access surface unmounts", async () => {
    const controller = new AbortController();
    const refresh = vi.fn(() => controller.abort());

    await expect(refreshPaymentProjection(refresh, {
      attempts: 10,
      signal: controller.signal,
      wait: vi.fn().mockResolvedValue(undefined)
    })).resolves.toBe("cancelled");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
