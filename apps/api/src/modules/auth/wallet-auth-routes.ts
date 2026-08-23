import { randomBytes } from "node:crypto";
import type { components } from "@veel/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import {
  extractBearerToken,
  extractCookieToken,
  extractRequestSessionToken,
  hasRecentAuthentication,
  recoveryLinkIntentCookieName,
  unauthorizedResponse,
  walletSessionCookieName
} from "./http-auth.js";
import { SupabaseAuthConfigurationError } from "../session/supabase-auth.js";
import type {
  ApplicationSessionVerifier,
  RecoveryIdentityVerifier
} from "../session/types.js";
import {
  buildWalletAuthMessage,
  hashNonce,
  verifySolanaMessageSignature
} from "../wallet/wallet-route-utils.js";
import {
  WalletAuthAccountNotFoundError,
  WalletAuthChallengeInvalidError,
  WalletAuthRepositoryConfigurationError,
  WalletRecoveryCredentialRequiredError,
  WalletRecoveryLinkConflictError,
  type WalletAuthRepository
} from "./wallet-auth-repository.js";

interface RegisterWalletAuthRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  recoveryIdentityVerifier: RecoveryIdentityVerifier;
  walletAuthRepository: WalletAuthRepository;
}

type CreateWalletAuthChallengeRequest = components["schemas"]["CreateWalletAuthChallengeRequest"];
type CreateWalletAuthSessionRequest = components["schemas"]["CreateWalletAuthSessionRequest"];

const walletAuthChallengeTtlMs = 10 * 60 * 1000;
const recoveryLinkIntentTtlMs = 10 * 60 * 1000;

export async function registerWalletAuthRoutes(
  app: FastifyInstance,
  options: RegisterWalletAuthRoutesOptions
): Promise<void> {
  app.post<{ Body: CreateWalletAuthChallengeRequest }>("/v1/auth/wallet/challenges", {
    ...mutationRateLimit("walletMutation", "createWalletAuthChallenge"),
    schema: contractRouteSchema("createWalletAuthChallenge")
  }, async (request, reply) => {
    const challengeBody = request.body;
    const nonce = randomBytes(18).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + walletAuthChallengeTtlMs);
    const message = buildWalletAuthMessage({
      domain: new URL(app.config.WEB_URL).host,
      uri: app.config.WEB_URL,
      address: challengeBody.address,
      chain: challengeBody.chain,
      purpose: challengeBody.purpose,
      nonce,
      issuedAt,
      expiresAt
    });

    try {
      const challenge = await options.walletAuthRepository.createChallenge({
        chain: challengeBody.chain,
        provider: challengeBody.provider,
        purpose: challengeBody.purpose,
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

  app.post<{ Body: CreateWalletAuthSessionRequest }>("/v1/auth/wallet/sessions", {
    ...mutationRateLimit("walletMutation", "createWalletAuthSession"),
    schema: contractRouteSchema("createWalletAuthSession")
  }, async (request, reply) => {
    const sessionBody = request.body;

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
        challenge.purpose !== sessionBody.purpose ||
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
        purpose: sessionBody.purpose,
        expiresAt: new Date(Date.now() + app.config.WALLET_AUTH_SESSION_TTL_SECONDS * 1000)
      });

      reply.header(
        "set-cookie",
        walletSessionCookie(session.accessToken, session.expiresAt, app.config.WALLET_AUTH_COOKIE_DOMAIN)
      );

      return reply.code(201).send({
        expiresAt: session.expiresAt.toISOString(),
        wallet: session.wallet
      });
    } catch (error) {
      if (error instanceof WalletAuthAccountNotFoundError) {
        return reply.code(404).send({
          code: "account_not_found",
          message: "No WeVid account is linked to this authentication method"
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

  app.post("/v1/auth/wallet/logout", mutationRateLimit("walletMutation", "revokeWalletAuthSession"), async (request, reply) => {
    const token = extractCookieToken(request.headers.cookie, walletSessionCookieName);

    try {
      if (token) {
        await options.walletAuthRepository.revokeSessionToken(token);
      }

      reply.header(
        "set-cookie",
        [
          expiredWalletSessionCookie(app.config.WALLET_AUTH_COOKIE_DOMAIN),
          expiredRecoveryIntentCookie(app.config.WALLET_AUTH_COOKIE_DOMAIN)
        ]
      );
      return reply.code(204).send();
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

  app.post("/v1/auth/sessions/logout-all", mutationRateLimit("walletMutation", "revokeAllApplicationSessions"), async (request, reply) => {
    const sessionToken = extractRequestSessionToken(request);
    const verifiedSession = sessionToken ? await options.authVerifier.verifyToken(sessionToken) : null;

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
    }
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send({
        code: "recent_authentication_required",
        message: "Authenticate again before logging out every device"
      });
    }

    try {
      await options.walletAuthRepository.revokeAllSessions({
        userId: verifiedSession.userId,
        actorUserId: verifiedSession.userId,
        reason: "user_logout_all"
      });
      reply.header("set-cookie", [
        expiredWalletSessionCookie(app.config.WALLET_AUTH_COOKIE_DOMAIN),
        expiredRecoveryIntentCookie(app.config.WALLET_AUTH_COOKIE_DOMAIN)
      ]);
      return reply.code(204).send();
    } catch (error) {
      return handleRepositoryError(request, reply, error);
    }
  });

  app.post("/v1/auth/recovery/link-intents", mutationRateLimit("walletMutation", "createRecoveryLinkIntent"), async (request, reply) => {
    const sessionToken = extractRequestSessionToken(request);
    const verifiedSession = sessionToken
      ? await options.authVerifier.verifyToken(sessionToken)
      : null;
    if (!verifiedSession) return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send({ code: "recent_authentication_required", message: "Authenticate again before changing recovery access" });
    }

    try {
      const intent = await options.walletAuthRepository.createRecoveryLinkIntent({
        sessionToken: sessionToken as string,
        expiresAt: new Date(Date.now() + recoveryLinkIntentTtlMs)
      });
      reply.header(
        "set-cookie",
        recoveryIntentCookie(
          intent.token,
          intent.expiresAt,
          app.config.WALLET_AUTH_COOKIE_DOMAIN
        )
      );
      return reply.code(201).send({ expiresAt: intent.expiresAt.toISOString() });
    } catch (error) {
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
      }
      return handleRepositoryError(request, reply, error);
    }
  });

  app.post("/v1/auth/recovery/exchange", mutationRateLimit("walletMutation", "exchangeRecoveryIdentity"), async (request, reply) => {
    const recoveryToken = extractBearerToken(request.headers.authorization);
    if (!recoveryToken) return reply.code(401).send(unauthorizedResponse("Recovery credential is missing or invalid"));

    try {
      const recoveryIdentity = await options.recoveryIdentityVerifier.verifyToken(recoveryToken);
      if (!recoveryIdentity) return reply.code(401).send(unauthorizedResponse("Recovery credential is missing or invalid"));

      const linkIntentToken = extractCookieToken(request.headers.cookie, recoveryLinkIntentCookieName);
      const session = await options.walletAuthRepository.exchangeRecoveryIdentity({
        provider: recoveryIdentity.provider,
        providerSubject: recoveryIdentity.providerSubject,
        ...(linkIntentToken ? { linkIntentToken } : {}),
        sessionExpiresAt: new Date(Date.now() + app.config.WALLET_AUTH_SESSION_TTL_SECONDS * 1000)
      });
      reply.header("set-cookie", [
        walletSessionCookie(session.accessToken, session.expiresAt, app.config.WALLET_AUTH_COOKIE_DOMAIN),
        expiredRecoveryIntentCookie(app.config.WALLET_AUTH_COOKIE_DOMAIN)
      ]);
      return reply.code(200).send({ expiresAt: session.expiresAt.toISOString() });
    } catch (error) {
      if (error instanceof SupabaseAuthConfigurationError) {
        request.log.warn({ error }, "Recovery identity verification is not configured");
        return reply.code(503).send({ code: "provider_unavailable", message: "Recovery identity verification is unavailable" });
      }
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Recovery exchange is invalid or expired"));
      }

      if (error instanceof WalletRecoveryLinkConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Recovery identity is already linked to another WeVid account"
        });
      }

      return handleRepositoryError(request, reply, error);
    }
  });

  app.post("/v1/auth/recovery/unlink", mutationRateLimit("walletMutation", "unlinkRecoveryIdentity"), async (request, reply) => {
    const sessionToken = extractRequestSessionToken(request);
    const verifiedSession = sessionToken ? await options.authVerifier.verifyToken(sessionToken) : null;
    if (!verifiedSession) return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
    if (!hasRecentAuthentication(verifiedSession.authenticatedAt)) {
      return reply.code(403).send({ code: "recent_authentication_required", message: "Authenticate again before changing recovery access" });
    }

    try {
      const session = await options.walletAuthRepository.unlinkRecoveryIdentity({
        sessionToken: sessionToken as string,
        provider: "supabase"
      });
      reply.header("set-cookie", walletSessionCookie(session.accessToken, session.expiresAt, app.config.WALLET_AUTH_COOKIE_DOMAIN));
      return reply.code(200).send({ expiresAt: session.expiresAt.toISOString() });
    } catch (error) {
      if (error instanceof WalletAuthChallengeInvalidError) {
        return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
      }
      if (error instanceof WalletRecoveryCredentialRequiredError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Link a wallet before removing your only recovery method"
        });
      }

      return handleRepositoryError(request, reply, error);
    }
  });
}

export function walletSessionCookie(token: string, expiresAt: Date, domain?: string) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const parts = [
    `${walletSessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function recoveryIntentCookie(token: string, expiresAt: Date, domain?: string) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return serializeRecoveryIntentCookie(encodeURIComponent(token), maxAge, domain);
}

function expiredRecoveryIntentCookie(domain?: string) {
  return serializeRecoveryIntentCookie("", 0, domain);
}

function serializeRecoveryIntentCookie(value: string, maxAge: number, domain?: string) {
  const parts = [
    `${recoveryLinkIntentCookieName}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (domain) parts.push(`Domain=${domain}`);
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function handleRepositoryError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof WalletAuthRepositoryConfigurationError) {
    request.log.warn({ error }, "Wallet auth repository is not configured");
    return reply.code(503).send({ code: "provider_unavailable", message: "Application session storage is not configured" });
  }
  throw error;
}

function expiredWalletSessionCookie(domain?: string) {
  const parts = [
    `${walletSessionCookieName}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}
