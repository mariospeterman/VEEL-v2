import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  extractBearerToken,
  extractCookieToken,
  unauthorizedResponse,
  walletSessionCookieName
} from "./http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import {
  buildWalletLinkMessage,
  hashNonce,
  verifySolanaMessageSignature
} from "../wallet/wallet-route-utils.js";
import type { WalletChain, WalletProvider } from "../wallet/types.js";
import {
  WalletAuthChallengeInvalidError,
  WalletAuthRepositoryConfigurationError,
  WalletRecoveryLinkConflictError,
  type WalletAuthRepository
} from "./wallet-auth-repository.js";

interface RegisterWalletAuthRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  walletAuthRepository: WalletAuthRepository;
}

interface CreateWalletAuthChallengeRequest {
  chain: WalletChain;
  provider: WalletProvider;
  address: string;
}

interface CreateWalletAuthSessionRequest {
  provider: WalletProvider;
  address: string;
  chain: WalletChain;
  proof: {
    challengeId: string;
    message: string;
    signature: string;
    signatureEncoding: "base58" | "base64";
  };
}

interface LinkSupabaseRecoveryRequest {
  walletSessionToken?: string;
}

const walletAuthChallengeTtlMs = 10 * 60 * 1000;

export async function registerWalletAuthRoutes(
  app: FastifyInstance,
  options: RegisterWalletAuthRoutesOptions
): Promise<void> {
  app.post("/v1/auth/wallet/challenges", async (request, reply) => {
    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as CreateWalletAuthChallengeRequest | undefined;
    const validationError = validateWalletAuthChallengeRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const challengeBody = body as CreateWalletAuthChallengeRequest;
    const nonce = randomBytes(18).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + walletAuthChallengeTtlMs);
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
      const challenge = await options.walletAuthRepository.createChallenge({
        chain: challengeBody.chain,
        provider: challengeBody.provider,
        address: challengeBody.address,
        message,
        nonceHash: hashNonce(nonce),
        expiresAt
      });

      return reply.code(201).send(challenge);
    } catch (error) {
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(400).send(validationResponse("Wallet auth challenge is invalid"));
      }

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet auth repository is not configured");
        return reply.code(503).send({
          code: "provider_unavailable",
          message: "Wallet auth storage is not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/auth/wallet/sessions", async (request, reply) => {
    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as CreateWalletAuthSessionRequest | undefined;
    const validationError = validateWalletAuthSessionRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const sessionBody = body as CreateWalletAuthSessionRequest;

    try {
      const challenge = await options.walletAuthRepository.findChallenge({
        challengeId: sessionBody.proof.challengeId
      });

      if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
        return reply.code(400).send(validationResponse("Wallet auth challenge is invalid"));
      }

      if (
        challenge.address !== sessionBody.address ||
        challenge.chain !== sessionBody.chain ||
        challenge.provider !== sessionBody.provider ||
        challenge.message !== sessionBody.proof.message
      ) {
        return reply
          .code(400)
          .send(validationResponse("Wallet auth challenge does not match request"));
      }

      if (
        !verifySolanaMessageSignature(
          sessionBody.address,
          sessionBody.proof.message,
          sessionBody.proof.signature,
          sessionBody.proof.signatureEncoding
        )
      ) {
        return reply.code(400).send(validationResponse("Wallet signature is invalid"));
      }

      const session = await options.walletAuthRepository.createSessionFromChallenge({
        challengeId: challenge.id,
        expiresAt: new Date(Date.now() + app.config.WALLET_AUTH_SESSION_TTL_SECONDS * 1000)
      });

      reply.header("set-cookie", walletSessionCookie(session.accessToken, session.expiresAt));

      return reply.code(201).send({
        accessToken: session.accessToken,
        tokenType: "Bearer",
        expiresAt: session.expiresAt.toISOString(),
        wallet: session.wallet
      });
    } catch (error) {
      if (error instanceof WalletAuthRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet auth repository is not configured");
        return reply.code(503).send({
          code: "provider_unavailable",
          message: "Wallet auth storage is not configured"
        });
      }

      throw error;
    }
  });

  app.post("/v1/auth/recovery-link", async (request, reply) => {
    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const bearerToken = extractBearerToken(request.headers.authorization);

    if (!bearerToken) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const verifiedSession = await options.authVerifier.verifyBearerToken(bearerToken);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const body = request.body as LinkSupabaseRecoveryRequest | undefined;
    const validationError = validateRecoveryLinkRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    try {
      const walletSessionToken =
        (body as LinkSupabaseRecoveryRequest | undefined)?.walletSessionToken ??
        extractCookieToken(request.headers.cookie, walletSessionCookieName);

      if (!walletSessionToken) {
        return reply.code(401).send(unauthorizedResponse("Wallet session is missing or expired"));
      }

      await options.walletAuthRepository.linkSupabaseRecovery({
        walletSessionToken,
        supabaseUserId: verifiedSession.supabaseUserId
      });

      return reply.code(200).send({
        state: "linked",
        provider: "supabase"
      });
    } catch (error) {
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Wallet session is missing or expired"));
      }

      if (error instanceof WalletRecoveryLinkConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Supabase recovery is already linked to another WeVid account"
        });
      }

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet auth repository is not configured");
        return reply.code(503).send({
          code: "provider_unavailable",
          message: "Wallet auth storage is not configured"
        });
      }

      throw error;
    }
  });
}

function validateWalletAuthChallengeRequest(
  body: CreateWalletAuthChallengeRequest | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!isWalletChain(body.chain)) {
    return "Unsupported wallet chain";
  }

  if (!isWalletProvider(body.provider)) {
    return "Unsupported wallet provider";
  }

  if (typeof body.address !== "string" || body.address.length < 32 || body.address.length > 64) {
    return "Invalid Solana wallet address";
  }

  return null;
}

function validateWalletAuthSessionRequest(
  body: CreateWalletAuthSessionRequest | undefined
): string | null {
  const challengeError = validateWalletAuthChallengeRequest(body);

  if (challengeError) {
    return challengeError;
  }

  if (!body?.proof || typeof body.proof !== "object") {
    return "Wallet auth proof is required";
  }

  if (!body.proof.challengeId || !body.proof.message || !body.proof.signature) {
    return "Wallet auth proof is incomplete";
  }

  if (body.proof.signatureEncoding !== "base58" && body.proof.signatureEncoding !== "base64") {
    return "Unsupported wallet signature encoding";
  }

  return null;
}

function validateRecoveryLinkRequest(body: LinkSupabaseRecoveryRequest | undefined): string | null {
  if (body !== undefined && (!body || typeof body !== "object")) {
    return "Request body must be an object";
  }

  if (
    body?.walletSessionToken !== undefined &&
    (typeof body.walletSessionToken !== "string" || !body.walletSessionToken.startsWith("veel_wallet_"))
  ) {
    return "Wallet session token is invalid";
  }

  return null;
}

function walletSessionCookie(token: string, expiresAt: Date) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const parts = [
    `${walletSessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function isWalletChain(value: string): value is WalletChain {
  return value === "solana_devnet" || value === "solana_mainnet";
}

function isWalletProvider(value: string): value is WalletProvider {
  return (
    value === "embedded_privy" ||
    value === "embedded_turnkey" ||
    value === "phantom" ||
    value === "solflare" ||
    value === "wallet_adapter"
  );
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
