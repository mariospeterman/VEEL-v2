import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

describe("Solana Pay server codec island", () => {
  it("loads under Node without browser globals and returns only plain strings", async () => {
    expect("window" in globalThis).toBe(false);
    expect("document" in globalThis).toBe(false);

    const codec = await import("./index.js");
    const transactionRequestUrl = codec.encodeSolanaPayTransactionRequest({
      link: `https://api.wevid.example/v1/payments/checkout/${"a".repeat(43)}`,
      label: "WeVid",
      message: "Approve this payment in your wallet"
    });
    const parsed = codec.parseSolanaPayTransactionRequest(transactionRequestUrl);

    expect(transactionRequestUrl).toMatch(/^solana:https:/u);
    expect(parsed).toEqual({
      link: `https://api.wevid.example/v1/payments/checkout/${"a".repeat(43)}`,
      label: "WeVid",
      message: "Approve this payment in your wallet"
    });
    expect(Object.values(parsed).every((value) => value === null || typeof value === "string")).toBe(
      true
    );
  });

  it("generates an SVG QR data URL entirely in Node", async () => {
    const codec = await import("./index.js");
    const transactionRequestUrl = codec.encodeSolanaPayTransactionRequest({
      link: `https://api.wevid.example/v1/payments/checkout/${"b".repeat(43)}`
    });
    const dataUrl = await codec.createSolanaPaySvgDataUrl(transactionRequestUrl);
    const svg = Buffer.from(dataUrl.split(",")[1] ?? "", "base64").toString("utf8");

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox=");
  });

  it("does not expose transfer requests through the narrow parser", async () => {
    const codec = await import("./index.js");

    expect(() =>
      codec.parseSolanaPayTransactionRequest(
        "solana:11111111111111111111111111111111?amount=1"
      )
    ).toThrow("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  });
});
