import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createStoredWeVidTransactionRequestUrl,
  createWeVidTransactionRequest,
  encodeWeVidTransactionRequest,
  parseWeVidTransactionRequest
} from "../src/modules/payment/solana-pay-codec.js";

const apiUrl = "https://api.wevid.example";
const checkoutToken = "a".repeat(43);
const metadata =
  "label=WeVid&message=Approve+this+payment+in+your+wallet";

describe("narrow maintained Solana Pay codec", () => {
  it("round trips the opaque WeVid transaction-request capability", () => {
    const request = encodeWeVidTransactionRequest({
      apiUrl,
      checkoutToken
    });
    const parsed = parseWeVidTransactionRequest(request.transactionRequestUrl, apiUrl);

    expect(parsed).toEqual({
      checkoutUrl: `${apiUrl}/v1/payments/checkout/${checkoutToken}`,
      label: "WeVid",
      message: "Approve this payment in your wallet"
    });
    expect(request.transactionRequestUrl).toMatch(/^solana:https:/u);
  });

  it("creates a server-rendered interoperable SVG QR data URL", async () => {
    const request = await createWeVidTransactionRequest({
      apiUrl: "http://127.0.0.1:8080",
      checkoutToken: "b".repeat(43)
    });
    const svg = Buffer.from(request.qrDataUrl.split(",")[1] ?? "", "base64").toString(
      "utf8"
    );

    expect(request.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(svg).toContain("<svg");
    expect(request.checkoutUrl).toBe(
      `http://127.0.0.1:8080/v1/payments/checkout/${"b".repeat(43)}`
    );
    expect(
      parseWeVidTransactionRequest(request.transactionRequestUrl, "http://127.0.0.1:8080")
    ).toMatchObject({ checkoutUrl: request.checkoutUrl });
  });

  it("keeps the stored audit value redacted without accepting redacted public requests", () => {
    const stored = createStoredWeVidTransactionRequestUrl(apiUrl);

    expect(stored).toContain("/redacted?");
    expect(() => parseWeVidTransactionRequest(stored, apiUrl)).toThrow(
      "SOLANA_PAY_CHECKOUT_TOKEN_INVALID"
    );
  });

  it("rejects transfer requests and unsafe non-local HTTP callback links", () => {
    expect(() =>
      parseWeVidTransactionRequest(
        "solana:11111111111111111111111111111111?amount=1",
        apiUrl
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:http://payments.example/v1/payments/checkout/${checkoutToken}?${metadata}`,
        "http://payments.example"
      )
    ).toThrow("SOLANA_PAY_API_URL_NOT_ALLOWED");
  });

  it("pins callback requests to the configured origin and exact checkout path", () => {
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:https://evil.example/v1/payments/checkout/${checkoutToken}?${metadata}`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_CHECKOUT_ORIGIN_NOT_ALLOWED");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:${apiUrl}/v1/payments/not-checkout/${checkoutToken}?${metadata}`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_CHECKOUT_PATH_NOT_ALLOWED");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:${apiUrl}/v1/payments/checkout/short?${metadata}`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_CHECKOUT_TOKEN_INVALID");
  });

  it("rejects fragments, credentials, and unexpected or duplicate metadata", () => {
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:${apiUrl}/v1/payments/checkout/${checkoutToken}?${metadata}#fragment`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_FRAGMENT_OR_USERINFO_NOT_ALLOWED");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:https://user:password@api.wevid.example/v1/payments/checkout/${checkoutToken}?${metadata}`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_CHECKOUT_URL_NOT_ALLOWED");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:${apiUrl}/v1/payments/checkout/${checkoutToken}?${metadata}&amount=1`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_METADATA_INVALID");
    expect(() =>
      parseWeVidTransactionRequest(
        `solana:${apiUrl}/v1/payments/checkout/${checkoutToken}?${metadata}&label=Other`,
        apiUrl
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_METADATA_INVALID");
  });

  it("rejects invalid capability tokens and unsafe API base URLs before encoding", () => {
    expect(() =>
      encodeWeVidTransactionRequest({
        apiUrl,
        checkoutToken: "../escape"
      })
    ).toThrow("SOLANA_PAY_CHECKOUT_TOKEN_INVALID");
    expect(() =>
      encodeWeVidTransactionRequest({
        apiUrl: "https://user:password@api.wevid.example",
        checkoutToken
      })
    ).toThrow("SOLANA_PAY_API_URL_NOT_ALLOWED");
    expect(() =>
      encodeWeVidTransactionRequest({
        apiUrl: `${apiUrl}#fragment`,
        checkoutToken
      })
    ).toThrow("SOLANA_PAY_API_URL_NOT_ALLOWED");
  });
});
