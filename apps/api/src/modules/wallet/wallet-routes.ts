import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  extractRequestSessionToken,
  hasRecentAuthentication,
  unauthorizedResponse,
  verifyRequestSession
} from "../auth/http-auth.js";
import { walletSessionCookie } from "../auth/wallet-auth-routes.js";
import {
  WalletAuthChallengeInvalidError,
  WalletAuthRepositoryConfigurationError,
  type WalletAuthRepository
} from "../auth/wallet-auth-repository.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import {
  WalletLinkChallengeNotFoundError,
  WalletLinkConflictError,
  WalletNotFoundError,
  WalletRepositoryConfigurationError
} from "./wallet-repository.js";
import { WalletOnrampProviderNotConfiguredError } from "./wallet-onramp-adapter.js";
import {
  buildWalletLinkMessage,
  hashNonce,
  isValidSolanaAddress,
  validateOnrampSessionRequest,
  verifySolanaMessageSignature
} from "./wallet-route-utils.js";
import type {
  CreateOnrampSessionRequest,
  CreateWalletLinkChallengeRequest,
  LinkWalletRequest,
  WalletOnrampProviderAdapter,
  WalletRepository
} from "./types.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";

interface RegisterWalletRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  walletRepository: WalletRepository;
  walletAuthRepository: WalletAuthRepository;
  onrampProvider: WalletOnrampProviderAdapter;
}

const walletChallengeTtlMs = 10 * 60 * 1000;

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

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        request.log.warn({ error }, "Application session rotation is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Application session rotation is unavailable" });
      }

      throw error;
    }
  });

  app.post<{ Body: CreateWalletLinkChallengeRequest }>("/v1/wallets/link-challenges", mutationRateLimit("walletMutation", "createWalletLinkChallenge"), async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send(recentAuthenticationRequired());
    }

    if (!isValidSolanaAddress(request.body.address)) {
      return reply.code(400).send(validationResponse("Invalid Solana wallet address"));
    }

    const challengeBody = request.body;
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

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        request.log.warn({ error }, "Application session rotation is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Application session rotation is unavailable" });
      }

      throw error;
    }
  });

  app.post<{ Body: LinkWalletRequest }>("/v1/wallets/link", mutationRateLimit("walletMutation", "linkWallet"), async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send(recentAuthenticationRequired());
    }

    if (!isValidSolanaAddress(request.body.address)) {
      return reply.code(400).send(validationResponse("Invalid Solana wallet address"));
    }

    const linkBody = request.body;
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

      const sessionToken = extractRequestSessionToken(request);
      if (!sessionToken) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      const result = await options.walletRepository.consumeVerifiedExternalWalletLink({
        challengeId: challenge.id,
        supabaseUserId: verifiedSession.supabaseUserId,
        sessionToken
      });
      reply.header("set-cookie", walletSessionCookie(result.session.accessToken, result.session.expiresAt, app.config.WALLET_AUTH_COOKIE_DOMAIN));

      return reply.code(201).send(result.wallet);
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

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        return sessionRotationUnavailable(request, reply, error);
      }
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
      }

      throw error;
    }
  });

  app.patch("/v1/wallets/:walletId/primary", mutationRateLimit("walletMutation", "setPrimaryWallet"), async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send(recentAuthenticationRequired());
    }

    const walletId = (request.params as { walletId?: string }).walletId;

    if (!walletId) {
      return reply.code(400).send(validationResponse("Wallet id is required"));
    }

    try {
      const sessionToken = extractRequestSessionToken(request);
      if (!sessionToken) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      const result = await options.walletRepository.setPrimaryWallet({
        walletId,
        supabaseUserId: verifiedSession.supabaseUserId,
        sessionToken
      });
      reply.header("set-cookie", walletSessionCookie(result.session.accessToken, result.session.expiresAt, app.config.WALLET_AUTH_COOKIE_DOMAIN));

      return reply.code(200).send(result.wallet);
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        return reply.code(404).send({
          code: "not_found",
          message: "Wallet was not found"
        });
      }

      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Wallet storage is not configured"));
      }

      if (error instanceof WalletAuthRepositoryConfigurationError) {
        return sessionRotationUnavailable(request, reply, error);
      }
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
      }

      throw error;
    }
  });

  app.post("/v1/wallets/onramp-sessions", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const idempotencyKey = request.headers["idempotency-key"];

    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as CreateOnrampSessionRequest | undefined;
    const validationError = validateOnrampSessionRequest(body);

    if (validationError) {
      return reply.code(400).send(validationResponse(validationError));
    }

    const onrampBody = body as CreateOnrampSessionRequest;

    try {
      const existing = await options.walletRepository.findOnrampSessionByIdempotencyKey({
        supabaseUserId: verifiedSession.supabaseUserId,
        idempotencyKey
      });

      if (existing) {
        return reply.code(201).send(existing);
      }

      const wallet = await options.walletRepository.findWalletForSupabaseUser({
        supabaseUserId: verifiedSession.supabaseUserId,
        walletId: onrampBody.walletId
      });

      if (!wallet) {
        return reply.code(404).send({
          code: "not_found",
          message: "Wallet was not found"
        });
      }

      const providerSession = await options.onrampProvider.createSession({
        supabaseUserId: verifiedSession.supabaseUserId,
        wallet,
        idempotencyKey,
        returnUrl: onrampBody.returnUrl ?? null,
        clientIp: request.ip
      });

      const session = await options.walletRepository.recordOnrampSession({
        supabaseUserId: verifiedSession.supabaseUserId,
        walletId: wallet.id,
        idempotencyKey,
        provider: providerSession.provider,
        providerSessionReferenceHash: providerSession.providerSessionReferenceHash,
        walletAddress: wallet.address,
        chain: wallet.chain,
        purchaseCurrency: providerSession.purchaseCurrency,
        launchUrl: providerSession.launchUrl,
        returnUrl: onrampBody.returnUrl ?? null,
        expiresAt: providerSession.expiresAt
      });

      return reply.code(201).send(session);
    } catch (error) {
      if (error instanceof WalletOnrampProviderNotConfiguredError) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Wallet funding provider is not configured"
        });
      }

      if (error instanceof WalletNotFoundError) {
        return reply.code(404).send({
          code: "not_found",
          message: "Wallet was not found"
        });
      }

      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Wallet storage is not configured"));
      }

      throw error;
    }
  });
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

function recentAuthenticationRequired() {
  return {
    code: "recent_authentication_required",
    message: "Authenticate again before changing wallet access"
  };
}

function sessionRotationUnavailable(
  request: FastifyRequest,
  reply: FastifyReply,
  error: WalletAuthRepositoryConfigurationError
) {
  request.log.warn({ error }, "Application session rotation is not configured");
  return reply.code(503).send({ code: "service_unavailable", message: "Application session rotation is unavailable" });
}
