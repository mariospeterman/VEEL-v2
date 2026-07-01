import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type {
  CreateOnrampSessionRequest,
  CreateWalletLinkChallengeRequest,
  LinkWalletRequest
} from "./types.js";

const externalWalletProviders = new Set(["phantom", "solflare", "wallet_adapter"]);
const walletChains = new Set(["solana_devnet", "solana_mainnet"]);

export function validateChallengeRequest(
  body: CreateWalletLinkChallengeRequest | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!walletChains.has(body.chain)) {
    return "Unsupported wallet chain";
  }

  if (!externalWalletProviders.has(body.provider)) {
    return "Unsupported external wallet provider";
  }

  if (!isValidSolanaAddress(body.address)) {
    return "Invalid Solana wallet address";
  }

  return null;
}

export function validateLinkWalletRequest(body: LinkWalletRequest | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!walletChains.has(body.chain)) {
    return "Unsupported wallet chain";
  }

  if (!externalWalletProviders.has(body.provider)) {
    return "Unsupported external wallet provider";
  }

  if (!isValidSolanaAddress(body.address)) {
    return "Invalid Solana wallet address";
  }

  if (!body.proof || typeof body.proof !== "object") {
    return "Wallet link proof is required";
  }

  if (!body.proof.challengeId || !body.proof.message || !body.proof.signature) {
    return "Wallet link proof is incomplete";
  }

  if (body.proof.signatureEncoding !== "base58" && body.proof.signatureEncoding !== "base64") {
    return "Unsupported wallet signature encoding";
  }

  return null;
}

export function validateOnrampSessionRequest(
  body: CreateOnrampSessionRequest | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.walletId) {
    return "Wallet id is required";
  }

  if (body.returnUrl) {
    try {
      const returnUrl = new URL(body.returnUrl);

      if (returnUrl.protocol !== "https:" && returnUrl.hostname !== "localhost") {
        return "Return URL must be HTTPS";
      }
    } catch {
      return "Return URL is invalid";
    }
  }

  return null;
}

export function buildWalletLinkMessage(input: {
  domain: string;
  uri: string;
  address: string;
  chain: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${input.domain} wants you to link this Solana wallet to WeVid.`,
    "",
    "This signature proves wallet ownership. It does not move funds or approve a payment.",
    "",
    `URI: ${input.uri}`,
    `Address: ${input.address}`,
    `Chain: ${input.chain}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`
  ].join("\n");
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function verifySolanaMessageSignature(
  address: string,
  message: string,
  signature: string,
  signatureEncoding: "base58" | "base64"
): boolean {
  try {
    const publicKey = new PublicKey(address);
    const signatureBytes =
      signatureEncoding === "base58" ? bs58.decode(signature) : Buffer.from(signature, "base64");
    const messageBytes = new TextEncoder().encode(message);

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  } catch {
    return false;
  }
}

function isValidSolanaAddress(address: string): boolean {
  try {
    const publicKey = new PublicKey(address);
    return PublicKey.isOnCurve(publicKey.toBytes());
  } catch {
    return false;
  }
}
