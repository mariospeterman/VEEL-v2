import type { FastifyInstance } from "fastify";
import {
  SessionRepositoryConfigurationError
} from "./session-repository.js";
import { SupabaseAuthConfigurationError } from "./supabase-auth.js";
import type {
  AppAccessState,
  SessionProfile,
  SessionRepository,
  SessionState,
  SupabaseAuthVerifier,
  UserResource
} from "./types.js";

interface RegisterSessionRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: RegisterSessionRoutesOptions
): Promise<void> {
  app.get("/v1/session", async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      return reply.code(401).send(unauthorizedResponse("Missing bearer token"));
    }

    try {
      const verifiedSession = await options.authVerifier.verifyBearerToken(token);

      if (!verifiedSession) {
        return reply.code(401).send(unauthorizedResponse("Invalid bearer token"));
      }

      const profile = await options.sessionRepository.findProfileBySupabaseUserId(
        verifiedSession.supabaseUserId
      );

      return reply.code(200).send(toSessionState(profile));
    } catch (error) {
      if (
        error instanceof SupabaseAuthConfigurationError ||
        error instanceof SessionRepositoryConfigurationError
      ) {
        request.log.warn({ error }, "Session dependency is not configured");
        return reply.code(401).send(unauthorizedResponse("Session verification is not configured"));
      }

      throw error;
    }
  });
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);

  if (scheme !== "Bearer" || !token || rest.length > 0) {
    return null;
  }

  return token;
}

function toSessionState(profile: SessionProfile | null): SessionState {
  if (!profile) {
    return {
      authenticated: true,
      appAccessState: identityRequired()
    };
  }

  const appAccessState: AppAccessState =
    profile.state === "active"
      ? profile.handle && profile.displayName
        ? { allowed: true, reason: "ready" }
        : identityRequired()
      : { allowed: false, reason: "blocked" };

  const sessionState: SessionState = {
    authenticated: true,
    appAccessState
  };

  if (profile.handle && profile.displayName) {
    sessionState.user = toUserResource(profile);
  }

  return sessionState;
}

function toUserResource(profile: SessionProfile): UserResource {
  return {
    id: profile.id,
    handle: profile.handle ?? "",
    displayName: profile.displayName ?? "",
    avatarUrl: profile.avatarUrl ?? null,
    badges: []
  };
}

function identityRequired(): AppAccessState {
  return { allowed: false, reason: "identity_required" };
}

function unauthorizedResponse(message: string) {
  return {
    code: "unauthorized",
    message
  };
}
