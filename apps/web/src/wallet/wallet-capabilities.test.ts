import type { Wallet } from "@solana/wallet-adapter-react";
import { describe, expect, it, vi } from "vitest";
import { walletSupportsMessageSigning } from "./wallet-capabilities";

function walletWithAdapter(adapter: Record<string, unknown>) {
  return { adapter: adapter as unknown as Wallet["adapter"] };
}

describe("walletSupportsMessageSigning", () => {
  it("accepts a legacy adapter with an exposed message signer", () => {
    expect(walletSupportsMessageSigning(walletWithAdapter({ signMessage: vi.fn() }))).toBe(true);
  });

  it("accepts a Wallet Standard adapter advertising Solana message signing before connection", () => {
    expect(walletSupportsMessageSigning(walletWithAdapter({
      standard: true,
      wallet: {
        features: {
          "solana:signMessage": { version: "1.0.0" },
          "solana:signTransaction": { version: "1.0.0" }
        }
      }
    }))).toBe(true);
  });

  it("rejects a transaction-only Wallet Standard adapter", () => {
    expect(walletSupportsMessageSigning(walletWithAdapter({
      standard: true,
      wallet: {
        features: {
          "solana:signTransaction": { version: "1.0.0" }
        }
      }
    }))).toBe(false);
  });

  it("rejects an adapter without a message-signing capability", () => {
    expect(walletSupportsMessageSigning(walletWithAdapter({ connect: vi.fn() }))).toBe(false);
  });
});
