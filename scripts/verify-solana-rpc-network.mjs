#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const referenceRpcByCluster = Object.freeze({
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet.solana.com"
});

export async function verifySolanaRpcNetwork({
  cluster,
  rpcUrl,
  fetchImpl = fetch,
  timeoutMs = 10_000
}) {
  const referenceRpcUrl = referenceRpcByCluster[cluster];
  if (!referenceRpcUrl) throw new Error("SOLANA_CLUSTER must be devnet or mainnet-beta");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");

  const [configuredGenesisHash, referenceGenesisHash] = await Promise.all([
    readGenesisHash(rpcUrl, fetchImpl, timeoutMs),
    readGenesisHash(referenceRpcUrl, fetchImpl, timeoutMs)
  ]);
  if (configuredGenesisHash !== referenceGenesisHash) {
    throw new Error(`Configured Solana RPC does not serve ${cluster}`);
  }

  return { cluster, genesisHash: configuredGenesisHash };
}

async function readGenesisHash(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "wevid-network-proof", method: "getGenesisHash", params: [] }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Solana RPC network proof failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.result !== "string" || payload.result.length < 32) {
    throw new Error("Solana RPC network proof returned an invalid genesis hash");
  }
  return payload.result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifySolanaRpcNetwork({
      cluster: process.env.SOLANA_CLUSTER,
      rpcUrl: process.env.SOLANA_RPC_URL
    });
    console.log(`Verified configured Solana RPC cluster=${result.cluster}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Solana RPC network proof failed");
    process.exitCode = 1;
  }
}
