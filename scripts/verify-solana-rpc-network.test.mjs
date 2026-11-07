import { describe, expect, it, vi } from "vitest";
import { verifySolanaRpcNetwork } from "./verify-solana-rpc-network.mjs";

describe("Solana RPC network proof", () => {
  it("accepts a private endpoint only when its genesis matches the canonical cluster reference", async () => {
    const fetchImpl = vi.fn(async () => response("same-genesis-hash-value-1234567890"));

    await expect(verifySolanaRpcNetwork({
      cluster: "devnet",
      rpcUrl: "https://private-rpc.example.test/secret",
      fetchImpl
    })).resolves.toMatchObject({ cluster: "devnet" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      "https://private-rpc.example.test/secret",
      "https://api.devnet.solana.com"
    ]));
  });

  it("rejects a configured endpoint serving a different network", async () => {
    const fetchImpl = vi.fn(async (url) => response(
      String(url).includes("private-rpc")
        ? "wrong-genesis-hash-value-123456789"
        : "expected-genesis-hash-value-123456"
    ));

    await expect(verifySolanaRpcNetwork({
      cluster: "mainnet-beta",
      rpcUrl: "https://private-rpc.example.test/secret",
      fetchImpl
    })).rejects.toThrow("does not serve mainnet-beta");
  });
});

function response(result) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { jsonrpc: "2.0", id: "wevid-network-proof", result };
    }
  };
}
