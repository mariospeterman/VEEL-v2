import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { findAgeStatusForUser, type AgeRepository } from "../age/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import {
  CreatorOnboardingIdempotencyConflictError,
  CreatorOnboardingTermsRequiredError,
  CreatorOnboardingWalletConflictError,
  ProfileHandleConflictError,
  ProfileRepositoryConfigurationError
} from "./profile-repository.js";
import type {
  ProfileRepository,
  UpdateCreatorOnboardingRequest,
  UpdateProfileRequest
} from "./types.js";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";
import { readIdempotentMutationRequest } from "../../shared/idempotency.js";
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
      const profile = await options.profileRepository.findCreatorProfileByHandle(
        handle,
        viewer?.userId ?? null
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

  app.patch("/v1/profiles/me", { schema: contractRouteSchema("updateMyProfile") }, async (request, reply) => {
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
    const validationError = getUpdateProfileValidationError(body, {
      allowLocalAvatarUrl: app.config.NODE_ENV !== "production"
    });

    if (validationError) {
      return reply.code(400).send({
        code: "validation_failed",
        message: validationError
      });
    }

    const updateProfile = body as Required<Pick<UpdateProfileRequest, "handle">> &
      Pick<UpdateProfileRequest, "displayName" | "avatarUrl" | "bio" | "locationLabel" | "links">;

    try {
      const user = await options.profileRepository.upsertMyProfile(verifiedSession.userId, {
        handle: updateProfile.handle.toLowerCase(),
        ...(Object.hasOwn(updateProfile, "displayName") ? { displayName: updateProfile.displayName } : {}),
        ...(Object.hasOwn(updateProfile, "avatarUrl") ? { avatarUrl: updateProfile.avatarUrl } : {}),
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

      const supabaseUrl = app.config.SUPABASE_URL;
      const supabaseKey = app.config.SUPABASE_SECRET_KEY ?? app.config.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        request.log.warn("Profile avatar upload is not configured");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Profile avatar upload is not configured"
        });
      }

      const contentType = body?.contentType as string;
      const decoded = Buffer.from(body?.dataBase64 as string, "base64");

      if (decoded.byteLength > maxAvatarBytes) {
        return reply.code(400).send({
          code: "validation_failed",
          message: "Profile picture must be 5MB or smaller"
        });
      }

      const extension = avatarExtension(contentType);
      const objectPath = `profiles/${verifiedSession.userId}/${randomUUID()}.${extension}`;
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false
        }
      });
      const upload = await supabase.storage
        .from(app.config.PROFILE_AVATAR_BUCKET)
        .upload(objectPath, decoded, {
          cacheControl: "31536000",
          contentType,
          upsert: false
        });

      if (upload.error) {
        request.log.warn({ error: upload.error }, "Profile avatar upload failed");
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Profile avatar upload is unavailable"
        });
      }

      const { data } = supabase.storage
        .from(app.config.PROFILE_AVATAR_BUCKET)
        .getPublicUrl(objectPath);

      return reply.code(201).send({
        avatarUrl: data.publicUrl
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

function getUpdateProfileValidationError(
  body: UpdateProfileRequest | undefined,
  options: { allowLocalAvatarUrl: boolean }
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const normalizedHandle = body.handle?.toLowerCase();
  if (!normalizedHandle || !handlePattern.test(normalizedHandle) || reservedHandles.has(normalizedHandle)) {
    return "Profile handle must be an available 2-32 character lowercase handle";
  }

  if (body.displayName !== undefined && (!body.displayName || body.displayName.length > 80)) {
    return "Display name must be 80 characters or fewer";
  }

  if (
    body.avatarUrl !== undefined &&
    body.avatarUrl !== null &&
    !isSafeAvatarUrl(body.avatarUrl, options)
  ) {
    return "Avatar URL must be a valid HTTPS URL";
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

function isSafeAvatarUrl(value: string, options: { allowLocalAvatarUrl: boolean }): boolean {
  if (isSafeHttpsUrl(value)) {
    return true;
  }

  if (!options.allowLocalAvatarUrl || value.length > 2048) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
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

function avatarExtension(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}
