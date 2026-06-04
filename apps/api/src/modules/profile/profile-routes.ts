import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import {
  ProfileHandleConflictError,
  ProfileRepositoryConfigurationError
} from "./profile-repository.js";
import type { ProfileRepository, UpdateProfileRequest } from "./types.js";

interface RegisterProfileRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  profileRepository: ProfileRepository;
}

const handlePattern = /^[a-zA-Z0-9_]{2,32}$/;

export async function registerProfileRoutes(
  app: FastifyInstance,
  options: RegisterProfileRoutesOptions
): Promise<void> {
  app.get("/v1/profiles/:handle", async (request, reply) => {
    const { handle } = request.params as { handle?: string };

    if (!handle || !handlePattern.test(handle)) {
      return reply.code(404).send({
        code: "not_found",
        message: "Profile was not found"
      });
    }

    try {
      const profile = await options.profileRepository.findCreatorProfileByHandle(handle);

      if (!profile) {
        return reply.code(404).send({
          code: "not_found",
          message: "Profile was not found"
        });
      }

      return reply.code(200).send(profile);
    } catch (error) {
      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(404).send({
          code: "not_found",
          message: "Profile was not found"
        });
      }

      throw error;
    }
  });

  app.get("/v1/profiles/me/creator-dashboard", async (request, reply) => {
    const access = await requireCreatorDashboardAccess(request, reply, options);

    if (!access) {
      return reply;
    }

    try {
      const dashboard = await options.profileRepository.getMyCreatorDashboard(access.supabaseUserId);

      if (!dashboard) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Creator dashboard requires a completed profile"
        });
      }

      return reply.code(200).send(dashboard);
    } catch (error) {
      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Profile storage is not configured"));
      }

      throw error;
    }
  });

  app.patch("/v1/profiles/me", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    if (!request.headers["idempotency-key"]) {
      return reply.code(400).send({
        code: "validation_failed",
        message: "Idempotency-Key header is required"
      });
    }

    const body = request.body as UpdateProfileRequest | undefined;
    const validationError = getUpdateProfileValidationError(body);

    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const updateProfile = body as Required<Pick<UpdateProfileRequest, "handle" | "displayName">> &
      Pick<UpdateProfileRequest, "bio" | "locationLabel">;

    try {
      await options.sessionRepository.ensureUserForSupabaseId(verifiedSession.supabaseUserId);
      const user = await options.profileRepository.upsertMyProfile(verifiedSession.supabaseUserId, {
        handle: updateProfile.handle,
        displayName: updateProfile.displayName,
        bio: updateProfile.bio,
        locationLabel: updateProfile.locationLabel
      });

      return reply.code(200).send(user);
    } catch (error) {
      if (error instanceof ProfileHandleConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Profile handle is already in use"
        });
      }

      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Profile storage is not configured"));
      }

      throw error;
    }
  });
}

async function requireCreatorDashboardAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterProfileRoutesOptions
): Promise<{ supabaseUserId: string } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
    reply.code(403).send({
      code: "forbidden",
      message: "Creator dashboard requires profile and age verification"
    });
    return null;
  }

  return {
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

function getUpdateProfileValidationError(
  body: UpdateProfileRequest | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.handle || !handlePattern.test(body.handle)) {
    return "Profile handle must be 2-32 letters, numbers, or underscores";
  }

  if (!body.displayName || body.displayName.length > 80) {
    return "Display name is required and must be 80 characters or fewer";
  }

  if (body.bio && body.bio.length > 500) {
    return "Bio must be 500 characters or fewer";
  }

  if (body.locationLabel && body.locationLabel.length > 120) {
    return "Location label must be 120 characters or fewer";
  }

  return null;
}
