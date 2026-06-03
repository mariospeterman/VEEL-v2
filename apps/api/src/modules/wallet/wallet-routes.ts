import { createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { FastifyInstance } from "fastify";
import nacl from "tweetnacl";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import {
  WalletLinkChallengeNotFoundError,
  WalletLinkConflictError,
  WalletRepositoryConfigurationError
} from "./wallet-repository.js";
import type {
  CreateWalletLinkChallengeRequest,
  LinkWalletRequest,
  WalletRepository
} from "./types.js";

interface RegisterWalletRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  walletRepository: WalletRepository;
}

const walletChallengeTtlMs = 10 * 60 * 1000;
const externalWalletProviders = new Set(["phantom", "solflare", "wallet_adapter"]);
const walletChains = new Set(["solana_devnet", "solana_mainnet"]);

export async function registerWalletRoutes(
  app: FastifyInstance,
  options: RegisterWalletRoutesOptions
): Promise<void> {
  app.get("/v1/wallets", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const wallets = await options.walletRepository.listWalletsBySupabaseUserId(
        verifiedSession.supabaseUserId
      );

      return reply.code(200).send({
        items: wallets
      });
    } catch (error) {
      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(200).send({
          items: []
        });
      }

      throw error;
    }
  });

  app.post("/v1/wallets/link-challenges", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as CreateWalletLinkChallengeRequest | undefined;
    const validationError = validateChallengeRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const challengeBody = body as CreateWalletLinkChallengeRequest;
    const nonce = randomBytes(18).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + walletChallengeTtlMs);
    const message = buildWalletLinkMessage({
      domain: new URL(app.config.WEB_URL).host,
      uri: app.config.WEB_URL,
      address: challengeBody.address,
      chain: challengeBody.chain,
      nonce,
      issuedAt,
      expiresAt
    });

    try {
      await options.sessionRepository.ensureUserForSupabaseId(verifiedSession.supabaseUserId);
      const challenge = await options.walletRepository.createLinkChallenge({
        supabaseUserId: verifiedSession.supabaseUserId,
        chain: challengeBody.chain,
        provider: challengeBody.provider,
        address: challengeBody.address,
        message,
        nonceHash: hashNonce(nonce),
        expiresAt
      });

      return reply.code(201).send(challenge);
    } catch (error) {
      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Wallet storage is not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/wallets/link", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as LinkWalletRequest | undefined;
    const validationError = validateLinkWalletRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const linkBody = body as LinkWalletRequest;
    try {
      const challenge = await options.walletRepository.findLinkChallenge({
        challengeId: linkBody.proof.challengeId,
        supabaseUserId: verifiedSession.supabaseUserId
      });

      if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
        return reply.code(400).send(validationResponse("Wallet link challenge is invalid"));
      }

      if (
        challenge.address !== linkBody.address ||
        challenge.chain !== linkBody.chain ||
        challenge.provider !== linkBody.provider ||
        challenge.message !== linkBody.proof.message
      ) {
        return reply
          .code(400)
          .send(validationResponse("Wallet link challenge does not match request"));
      }

      if (
        !verifySolanaMessageSignature(
          linkBody.address,
          linkBody.proof.message,
          linkBody.proof.signature,
          linkBody.proof.signatureEncoding
        )
      ) {
        return reply.code(400).send(validationResponse("Wallet signature is invalid"));
      }

      const wallet = await options.walletRepository.consumeVerifiedExternalWalletLink({
        challengeId: challenge.id,
        supabaseUserId: verifiedSession.supabaseUserId
      });

      return reply.code(201).send(wallet);
    } catch (error) {
      if (error instanceof WalletLinkConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Wallet is already linked"
        });
      }

      if (error instanceof WalletLinkChallengeNotFoundError) {
        return reply.code(400).send(validationResponse("Wallet link challenge is invalid"));
      }

      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Wallet storage is not configured"));
      }

      throw error;
    }
  });
}

function validateChallengeRequest(
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

function validateLinkWalletRequest(body: LinkWalletRequest | undefined): string | null {
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

function buildWalletLinkMessage(input: {
  domain: string;
  uri: string;
  address: string;
  chain: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${input.domain} wants you to link this Solana wallet to Veel.`,
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

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function isValidSolanaAddress(address: string): boolean {
  try {
    const publicKey = new PublicKey(address);
    return PublicKey.isOnCurve(publicKey.toBytes());
  } catch {
    return false;
  }
}

function verifySolanaMessageSignature(
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

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
