import { describe, expect, it } from "vitest";
import {
  commerceKitReviewedCommit,
  commerceKitSolanaPayVersion,
  createWeVidTransactionRequest,
  encodeWeVidTransactionRequest,
  parseWeVidTransactionRequest
} from "../src/modules/payment/solana-pay-codec.js";

describe("narrow Commerce Kit Solana Pay codec", () => {
  it("round trips the opaque WeVid transaction-request capability", () => {
    const request = encodeWeVidTransactionRequest({
      apiUrl: "https://api.wevid.example",
      checkoutToken: "a".repeat(43)
    });
    const parsed = parseWeVidTransactionRequest(request.transactionRequestUrl);

    expect(parsed).toEqual({
      checkoutUrl: "https://api.wevid.example/v1/payments/checkout/" + "a".repeat(43),
      label: "WeVid",
      message: "Approve this payment in your wallet"
    });
    expect(request.transactionRequestUrl).toMatch(/^solana:https:/);
  });

  it("creates an interoperable QR data URL without adding payment authority", async () => {
    const request = await createWeVidTransactionRequest({
      apiUrl: "http://127.0.0.1:8080",
      checkoutToken: "b".repeat(43)
    });

    expect(request.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(request.checkoutUrl).toContain("/v1/payments/checkout/");
  });

  it("rejects transfer requests and unsafe non-HTTPS callback links", () => {
    expect(() =>
      parseWeVidTransactionRequest(
        "solana:11111111111111111111111111111111?amount=1"
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
    expect(() =>
      parseWeVidTransactionRequest("solana:http://payments.example/checkout")
    ).toThrow("SOLANA_PAY_CHECKOUT_URL_NOT_ALLOWED");
  });

  it("locks the reviewed pre-1.0 provider source", () => {
    expect(commerceKitSolanaPayVersion).toBe("0.1.1");
    expect(commerceKitReviewedCommit).toBe(
      "6164d5104f3d1bd4cfbb637075f000d6ac23d6c3"
    );
  });
});
