import type { FastifyInstance } from "fastify";
import { AgeRepositoryConfigurationError } from "../age/age-repository.js";
import type { AgeRepository, AgeStatus } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { WalletRepositoryConfigurationError } from "../wallet/wallet-repository.js";
import type { WalletRepository } from "../wallet/types.js";
import { SessionRepositoryConfigurationError } from "./session-repository.js";
import type {
  AppAccessState,
  SessionProfile,
  SessionRepository,
  SessionState,
  ApplicationSessionVerifier,
  UserResource
} from "./types.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";

interface RegisterSessionRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: RegisterSessionRoutesOptions
): Promise<void> {
  app.get("/v1/session", { schema: contractRouteSchema("getSession") }, async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Application session is missing or expired"));
    }

    try {
      const [profile, ageStatus, hasWallet] = await Promise.all([
        options.sessionRepository.findProfileByUserId(verifiedSession.userId),
        options.ageRepository.findLatestAgeStatusBySupabaseUserId(
          verifiedSession.supabaseUserId
        ),
        options.walletRepository.hasWalletBySupabaseUserId(
          verifiedSession.supabaseUserId
        )
      ]);

      return reply.code(200).send(toSessionState(profile, ageStatus, hasWallet));
    } catch (error) {
      if (error instanceof AgeRepositoryConfigurationError) {
        const profile = await options.sessionRepository.findProfileByUserId(verifiedSession.userId);

        return reply.code(200).send(toSessionState(profile, requiredAgeStatus(), false));
      }

      if (error instanceof WalletRepositoryConfigurationError) {
        const [profile, ageStatus] = await Promise.all([
          options.sessionRepository.findProfileByUserId(verifiedSession.userId),
          options.ageRepository.findLatestAgeStatusBySupabaseUserId(
            verifiedSession.supabaseUserId
          )
        ]);

        return reply.code(200).send(toSessionState(profile, ageStatus, false));
      }

      if (error instanceof SessionRepositoryConfigurationError) {
        request.log.warn({ error }, "Session dependency is not configured");
        return reply.code(401).send(unauthorizedResponse("Session verification is not configured"));
      }

      throw error;
    }
  });
}

function toSessionState(
  profile: SessionProfile | null,
  ageStatus: AgeStatus,
  hasWallet: boolean
): SessionState {
  if (!profile) {
    return {
      authenticated: true,
      appAccessState: identityRequired()
    };
  }

  const appAccessState: AppAccessState =
    profile.state === "active" || profile.state === "provisional"
      ? profile.handle
        ? toAppAccessState(ageStatus, hasWallet)
        : identityRequired()
      : { allowed: false, reason: "blocked" };

  const sessionState: SessionState = {
    authenticated: true,
    appAccessState
  };

  if (profile.handle) {
    sessionState.user = toUserResource(profile);
  }

  return sessionState;
}

function toUserResource(profile: SessionProfile): UserResource {
  return {
    id: profile.id,
    handle: profile.handle ?? "",
    displayName: profile.displayName ?? profile.handle ?? "",
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

function toAppAccessState(ageStatus: AgeStatus, hasWallet: boolean): AppAccessState {
  if (ageStatus.state === "pending") {
    return { allowed: false, reason: "age_pending" };
  }

  if (ageStatus.state !== "verified" && ageStatus.state !== "not_required") {
    return { allowed: false, reason: "age_required" };
  }

  if (!hasWallet) {
    return { allowed: false, reason: "wallet_required" };
  }

  return { allowed: true, reason: "ready" };
}
