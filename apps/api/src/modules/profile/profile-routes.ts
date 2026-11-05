import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { findAgeStatusForUser, type AgeRepository } from "../age/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import {
  CreatorOnboardingIdempotencyConflictError,
  CreatorOnboardingTermsRequiredError,
  CreatorOnboardingWalletConflictError,
  ProfileHandleConflictError,
  ProfileIdempotencyConflictError,
  ProfileRepositoryConfigurationError
} from "./profile-repository.js";
import type {
  ProfileRepository,
  UpdateCreatorOnboardingRequest,
  UpdateProfileRequest
} from "./types.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { readIdempotencyKey, readIdempotentMutationRequest } from "../../shared/idempotency.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";

interface RegisterProfileRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  profileRepository: ProfileRepository;
}

const handlePattern = /^[a-z0-9_]{2,32}$/;
const reservedHandles = new Set([
  "admin", "administrator", "api", "app", "auth", "help", "legal", "login",
  "moderator", "privacy", "root", "security", "settings", "staff", "support",
  "system", "terms", "wevid", "veel"
]);
const avatarContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxAvatarBytes = 5_000_000;

interface AvatarUploadRequest {
  contentType?: unknown;
  dataBase64?: unknown;
  fileName?: unknown;
}

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
      const viewer = await verifyRequestSession(request, options.authVerifier);
      let eligibleViewerUserId: string | null = null;
      if (viewer) {
        try {
          const ageStatus = await findAgeStatusForUser(options.ageRepository, viewer.userId);
          if (ageStatus.state === "verified") {
            eligibleViewerUserId = viewer.userId;
          }
        } catch (error) {
          request.log.warn(
            { error, viewerUserId: viewer.userId },
            "Profile viewer age status is unavailable; using public eligibility"
          );
        }
      }
      const profile = await options.profileRepository.findCreatorProfileByHandle(
        handle,
        eligibleViewerUserId
      );

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

  app.get("/v1/profiles/handles/:handle/availability", { schema: contractRouteSchema("getProfileHandleAvailability") }, async (request, reply) => {
    const rawHandle = (request.params as { handle?: string }).handle ?? "";
    const handle = rawHandle.toLowerCase();
    if (!handlePattern.test(handle) || reservedHandles.has(handle)) {
      return reply.code(200).send({ handle, available: false });
    }

    try {
      return reply.code(200).send({
        handle,
        available: await options.profileRepository.isHandleAvailable(handle)
      });
    } catch (error) {
      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(503).send({ code: "service_unavailable", message: "Profile storage is not configured" });
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
      const dashboard = await options.profileRepository.getMyCreatorDashboard(access.userId);

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

  app.get("/v1/profiles/me/creator-onboarding", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const onboarding = await options.profileRepository.getMyCreatorOnboarding(
        verifiedSession.userId
      );

      if (!onboarding) {
        return reply.code(403).send({
          code: "forbidden",
          message: "Creator onboarding requires a WeVid account"
        });
      }

      return reply.code(200).send(onboarding);
    } catch (error) {
      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Profile storage is not configured"));
      }

      throw error;
    }
  });

  app.patch(
    "/v1/profiles/me/creator-onboarding",
    mutationRateLimit("paymentMutation", "updateMyCreatorOnboarding"),
    async (request, reply) => {
      const verifiedSession = await verifyRequestSession(request, options.authVerifier);

      if (!verifiedSession) {
        return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      }

      const body = request.body as UpdateCreatorOnboardingRequest;
      const mutation = readIdempotentMutationRequest(request, body);
      if ("code" in mutation) {
        return reply.code(400).send(mutation);
      }

      if (!options.profileRepository.updateMyCreatorOnboarding) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Creator earnings setup is not configured"
        });
      }

      try {
        const onboarding = await options.profileRepository.updateMyCreatorOnboarding({
          userId: verifiedSession.userId,
          idempotencyKey: mutation.idempotencyKey,
          requestHash: mutation.requestHash,
          expectedWalletChain:
            app.config.SOLANA_CLUSTER === "mainnet-beta" ? "solana_mainnet" : "solana_devnet",
          request: body
        });

        if (!onboarding) {
          return reply.code(403).send({
            code: "forbidden",
            message: "Creator onboarding requires an active WeVid account"
          });
        }

        return reply.code(200).send(onboarding);
      } catch (error) {
        if (error instanceof CreatorOnboardingIdempotencyConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Idempotency key was already used for a different earnings setup"
          });
        }
        if (error instanceof CreatorOnboardingWalletConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Select a linked Solana wallet for the current network"
          });
        }
        if (error instanceof CreatorOnboardingTermsRequiredError) {
          return reply.code(400).send({
            code: "validation_failed",
            message: "Accept the current Creator Earnings Terms"
          });
        }
        if (error instanceof ProfileRepositoryConfigurationError) {
          request.log.warn({ error }, "Profile repository is not configured");
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Creator earnings setup is not configured"
          });
        }
        throw error;
      }
    }
  );

  app.patch("/v1/profiles/me", {
    schema: contractRouteSchema("updateMyProfile"),
    preValidation: async (request, reply) => {
      if (hasAvatarUrlProperty(request.body)) {
        await reply.code(400).send({
          code: "validation_failed",
          message: "Profile pictures must be changed through the private avatar authority"
        });
      }
    }
  }, async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
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

    const updateProfile = body as Required<Pick<UpdateProfileRequest, "handle">> &
      Pick<UpdateProfileRequest, "displayName" | "bio" | "locationLabel" | "links">;

    try {
      const user = await options.profileRepository.upsertMyProfile(verifiedSession.userId, {
        idempotencyKey,
        handle: updateProfile.handle.toLowerCase(),
        ...(Object.hasOwn(updateProfile, "displayName") ? { displayName: updateProfile.displayName } : {}),
        ...(Object.hasOwn(updateProfile, "bio") ? { bio: updateProfile.bio } : {}),
        ...(Object.hasOwn(updateProfile, "locationLabel") ? { locationLabel: updateProfile.locationLabel } : {}),
        ...(Object.hasOwn(updateProfile, "links") ? { links: updateProfile.links } : {})
      });

      return reply.code(200).send(user);
    } catch (error) {
      if (error instanceof ProfileHandleConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Profile handle is already in use"
        });
      }

      if (error instanceof ProfileIdempotencyConflictError) {
        return reply.code(409).send({
          code: "conflict",
          message: "Idempotency key was already used for a different profile update"
        });
      }

      if (error instanceof ProfileRepositoryConfigurationError) {
        request.log.warn({ error }, "Profile repository is not configured");
        return reply.code(401).send(unauthorizedResponse("Profile storage is not configured"));
      }

      throw error;
    }
  });

  app.post(
    "/v1/profiles/me/avatar",
    {
      bodyLimit: Math.ceil(maxAvatarBytes * 1.45),
      schema: contractRouteSchema("uploadMyProfileAvatar")
    },
    async (request, reply) => {
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

      const body = request.body as AvatarUploadRequest | undefined;
      const validationError = getAvatarUploadValidationError(body);

      if (validationError) {
        return reply.code(400).send({
          code: "validation_failed",
          message: validationError
        });
      }

      request.log.warn(
        { userId: verifiedSession.userId },
        "Profile avatar upload is disabled until the private sanitized release lifecycle is configured"
      );
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Profile pictures are temporarily unavailable; continue without one"
      });
    }
  );
}

async function requireCreatorDashboardAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterProfileRoutesOptions
): Promise<{ userId: string } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileByUserId(verifiedSession.userId),
    findAgeStatusForUser(options.ageRepository, verifiedSession.userId)
  ]);

  if (profile?.state !== "active" || !profile.handle || ageStatus.state !== "verified") {
    reply.code(403).send({
      code: "forbidden",
      message: "Creator dashboard requires profile and age verification"
    });
    return null;
  }

  return {
    userId: verifiedSession.userId
  };
}

function getUpdateProfileValidationError(body: UpdateProfileRequest | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (hasAvatarUrlProperty(body)) {
    return "Profile pictures must be changed through the private avatar authority";
  }

  const normalizedHandle = body.handle?.toLowerCase();
  if (!normalizedHandle || !handlePattern.test(normalizedHandle) || reservedHandles.has(normalizedHandle)) {
    return "Profile handle must be an available 2-32 character lowercase handle";
  }

  if (body.displayName !== undefined && (!body.displayName || body.displayName.length > 80)) {
    return "Display name must be 80 characters or fewer";
  }

  if (body.bio && body.bio.length > 500) {
    return "Bio must be 500 characters or fewer";
  }

  if (body.locationLabel && body.locationLabel.length > 120) {
    return "Location label must be 120 characters or fewer";
  }

  if (body.links !== undefined) {
    if (!Array.isArray(body.links) || body.links.length > 5) {
      return "Profile links must include at most 5 links";
    }

    for (const link of body.links) {
      if (!link || typeof link !== "object") {
        return "Profile links must be objects";
      }

      if (!link.label || link.label.length > 32) {
        return "Profile link labels must be 32 characters or fewer";
      }

      if (!isSafeHttpsUrl(link.url)) {
        return "Profile link URLs must be valid HTTPS URLs";
      }
    }
  }

  return null;
}

function hasAvatarUrlProperty(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && Object.hasOwn(body, "avatarUrl"));
}

function isSafeHttpsUrl(value: string): boolean {
  if (value.length > 2048) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function getAvatarUploadValidationError(body: AvatarUploadRequest | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.contentType !== "string" || !avatarContentTypes.has(body.contentType)) {
    return "Profile picture must be JPEG, PNG, or WebP";
  }

  if (typeof body.dataBase64 !== "string" || body.dataBase64.length === 0) {
    return "Profile picture data is required";
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.dataBase64)) {
    return "Profile picture data is invalid";
  }

  const estimatedBytes = Math.floor((body.dataBase64.length * 3) / 4);
  if (estimatedBytes > maxAvatarBytes + 4) {
    return "Profile picture must be 5MB or smaller";
  }

  if (body.fileName !== undefined && typeof body.fileName !== "string") {
    return "Profile picture filename is invalid";
  }

  return null;
}
