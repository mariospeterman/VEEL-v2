import type { FastifyRequest } from "fastify";
import type { ApplicationSessionVerifier, VerifiedApplicationSession } from "../session/types.js";

export const walletSessionCookieName = "wevid_session";
export const recoveryLinkIntentCookieName = "veel_recovery_link_intent";

export const recentAuthenticationWindowMs = 15 * 60 * 1000;

export function hasRecentAuthentication(authenticatedAt: Date, now = new Date()): boolean {
  const ageMs = now.getTime() - authenticatedAt.getTime();
  return ageMs >= 0 && ageMs <= recentAuthenticationWindowMs;
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);

  if (scheme !== "Bearer" || !token || rest.length > 0) {
    return null;
  }

  return token;
}

export function extractCookieToken(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function verifyRequestSession(
  request: FastifyRequest,
  authVerifier: ApplicationSessionVerifier
): Promise<VerifiedApplicationSession | null> {
  const token = extractRequestSessionToken(request);

  if (!token) {
    return null;
  }

  return authVerifier.verifyToken(token);
}

export function extractRequestSessionToken(request: FastifyRequest): string | null {
  return (
    extractCookieToken(request.headers.cookie, walletSessionCookieName) ??
    extractBearerToken(request.headers.authorization)
  );
}

export function unauthorizedResponse(message: string) {
  return {
    code: "unauthorized",
    message
  };
}
