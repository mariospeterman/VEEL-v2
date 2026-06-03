import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import {
  ProfileHandleConflictError,
  ProfileRepositoryConfigurationError
} from "./profile-repository.js";
import type { ProfileRepository, UpdateProfileRequest } from "./types.js";

interface RegisterProfileRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  profileRepository: ProfileRepository;
}

const handlePattern = /^[a-zA-Z0-9_]{2,32}$/;

export async function registerProfileRoutes(
  app: FastifyInstance,
  options: RegisterProfileRoutesOptions
): Promise<void> {
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
