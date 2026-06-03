import type { FastifyRequest } from "fastify";
import { SupabaseAuthConfigurationError } from "../session/supabase-auth.js";
import type { SupabaseAuthVerifier, VerifiedSupabaseSession } from "../session/types.js";

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

export async function verifyRequestSession(
  request: FastifyRequest,
  authVerifier: SupabaseAuthVerifier
): Promise<VerifiedSupabaseSession | null> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    return null;
  }

  try {
    return await authVerifier.verifyBearerToken(token);
  } catch (error) {
    if (error instanceof SupabaseAuthConfigurationError) {
      request.log.warn({ error }, "Supabase auth is not configured");
      return null;
    }

    throw error;
  }
}

export function unauthorizedResponse(message: string) {
  return {
    code: "unauthorized",
    message
  };
}
