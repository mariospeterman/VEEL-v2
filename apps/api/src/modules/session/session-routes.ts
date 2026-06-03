import type { FastifyInstance } from "fastify";
import { AgeRepositoryConfigurationError } from "../age/age-repository.js";
import type { AgeRepository, AgeStatus } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { SessionRepositoryConfigurationError } from "./session-repository.js";
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
  ageRepository: AgeRepository;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: RegisterSessionRoutesOptions
): Promise<void> {
  app.get("/v1/session", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const [profile, ageStatus] = await Promise.all([
        options.sessionRepository.findProfileBySupabaseUserId(
          verifiedSession.supabaseUserId
        ),
        options.ageRepository.findLatestAgeStatusBySupabaseUserId(
          verifiedSession.supabaseUserId
        )
      ]);

      return reply.code(200).send(toSessionState(profile, ageStatus));
    } catch (error) {
      if (error instanceof AgeRepositoryConfigurationError) {
        const profile = await options.sessionRepository.findProfileBySupabaseUserId(
          verifiedSession.supabaseUserId
        );

        return reply.code(200).send(toSessionState(profile, requiredAgeStatus()));
      }

      if (error instanceof SessionRepositoryConfigurationError) {
        request.log.warn({ error }, "Session dependency is not configured");
        return reply.code(401).send(unauthorizedResponse("Session verification is not configured"));
      }

      throw error;
    }
  });
}

function toSessionState(profile: SessionProfile | null, ageStatus: AgeStatus): SessionState {
  if (!profile) {
    return {
      authenticated: true,
      appAccessState: identityRequired()
    };
  }

  const appAccessState: AppAccessState =
    profile.state === "active"
      ? profile.handle && profile.displayName
        ? toAppAccessState(ageStatus)
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

function requiredAgeStatus(): AgeStatus {
  return {
    state: "required",
    provider: null
  };
}

function toAppAccessState(ageStatus: AgeStatus): AppAccessState {
  if (ageStatus.state === "verified" || ageStatus.state === "not_required") {
    return { allowed: true, reason: "ready" };
  }

  if (ageStatus.state === "pending") {
    return { allowed: false, reason: "age_pending" };
  }

  return { allowed: false, reason: "age_required" };
}
