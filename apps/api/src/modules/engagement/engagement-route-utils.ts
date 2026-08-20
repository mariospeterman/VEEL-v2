import type { FastifyReply, FastifyRequest } from "fastify";
import {
  readIdempotencyKey,
  requireIdempotencyKey as requireSharedIdempotencyKey
} from "../../shared/idempotency.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import {
  EngagementIdempotencyConflictError,
  EngagementNotFoundError,
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";
import type {
  CreateReportRequest,
  CreateShareRequest,
  EngagementRepository,
  UpdateFeedPreferencesRequest
} from "./types.js";

export interface RegisterEngagementRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  engagementRepository: EngagementRepository;
}

const feedModes = new Set(["recommended", "following"]);
const nsfwPreferences = new Set(["both", "nsfw", "sfw"]);
const shareModes = new Set(["internal_message", "external_referral_link", "copy_link"]);
const shareTargetTypes = new Set(["content", "profile", "event"]);
const reportSubjectTypes = new Set(["content", "user", "message", "live_room", "event"]);

export async function toggleContentAction(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterEngagementRoutesOptions,
  action: "like" | "save"
) {
  const access = await verifyEngagementAccess(request, options);
  if (!access.ok) return reply.code(access.statusCode).send(access.body);
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
  }
  const params = request.params as { contentId?: string };
  const contentId = params.contentId;
  if (!isUuid(contentId)) return reply.code(400).send(validationResponse("contentId must be a UUID"));

  return repositoryReply(request, reply, async () =>
    action === "like"
      ? options.engagementRepository.toggleLike({
          supabaseUserId: access.supabaseUserId,
          contentId,
          idempotencyKey
        })
      : options.engagementRepository.toggleSave({
          supabaseUserId: access.supabaseUserId,
          contentId,
          idempotencyKey
        })
  );
}

type EngagementAccessResult =
  | { ok: true; supabaseUserId: string }
  | { ok: false; statusCode: 401 | 403; body: { code: string; message: string } };

export async function verifyEngagementAccess(
  request: FastifyRequest,
  options: RegisterEngagementRoutesOptions
): Promise<EngagementAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);
  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Engagement requires profile and age verification"
      }
    };
  }

  return { ok: true, supabaseUserId: verifiedSession.supabaseUserId };
}

export async function repositoryReply<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<T>,
  statusCode = 200
) {
  try {
    return reply.code(statusCode).send(await handler());
  } catch (error) {
    if (error instanceof EngagementRepositoryConfigurationError) {
      request.log.warn({ error }, "Engagement repository is not configured");
      return reply.code(503).send({
        code: "provider_unavailable",
        message: "Engagement is not configured"
      });
    }

    if (error instanceof EngagementPolicyError) {
      return reply.code(403).send({
        code: "forbidden",
        message: error.message
      });
    }

    if (error instanceof EngagementIdempotencyConflictError) {
      return reply.code(409).send({
        code: "conflict",
        message: "Idempotency key was already used for a different engagement action"
      });
    }

    if (error instanceof EngagementNotFoundError) {
      return reply.code(404).send({
        code: "not_found",
        message: "Profile was not found"
      });
    }

    throw error;
  }
}

export function requireIdempotencyKey(
  request: FastifyRequest
): { code: string; message: string } | null {
  return requireSharedIdempotencyKey(request);
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

export function isFeedMode(
  value: unknown
): value is NonNullable<UpdateFeedPreferencesRequest["defaultMode"]> {
  return typeof value === "string" && feedModes.has(value);
}

export function isNsfwPreference(
  value: unknown
): value is NonNullable<UpdateFeedPreferencesRequest["nsfwPreference"]> {
  return typeof value === "string" && nsfwPreferences.has(value);
}

export function isShareTargetType(value: unknown): value is CreateShareRequest["targetType"] {
  return typeof value === "string" && shareTargetTypes.has(value);
}

export function isShareMode(value: unknown): value is CreateShareRequest["mode"] {
  return typeof value === "string" && shareModes.has(value);
}

export function isReportSubjectType(value: unknown): value is CreateReportRequest["subjectType"] {
  return typeof value === "string" && reportSubjectTypes.has(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
