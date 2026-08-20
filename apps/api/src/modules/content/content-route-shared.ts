import type { FastifyRequest } from "fastify";
import type { components } from "@veel/contracts";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { LiveRepository } from "../live/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { SubscriptionRepository } from "../subscription/types.js";
import { VerificationRepositoryConfigurationError } from "../verification/verification-repository.js";
import type { VerificationRepository } from "../verification/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type {
  ContentRepository,
  FeedMode,
  FeedSurface,
  MediaUploadProviderAdapter
} from "./types.js";

export interface RegisterContentRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
  mediaUploadProvider: MediaUploadProviderAdapter;
  liveRepository?: LiveRepository;
  verificationRepository: VerificationRepository;
  subscriptionRepository: SubscriptionRepository;
}

export const feedModes = new Set(["recommended", "following"]);
export const feedSurfaces = new Set(["home", "bits"]);
export const contentMediaTypes = new Set(["bit", "clip", "image", "vod", "live_replay"]);
export const contentVisibilityValues = new Set(["public", "followers", "subscribers", "private"]);
export const nsfwLabels = new Set(["none", "adult", "explicit"]);
export const representationModes = new Set([
  "no_real_person",
  "self_only",
  "declared_performers"
]);
export const videoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const dailyContentDraftQuota = 20;
export const dailyMediaUploadQuota = 30;
export const contentCreationQuotaWindowHours = 24;

export interface ContentCreationAbusePolicy {
  dailyContentDraftQuota: number;
  dailyMediaUploadQuota: number;
  rollingWindowHours: number;
}

export const defaultContentCreationAbusePolicy: ContentCreationAbusePolicy = {
  dailyContentDraftQuota,
  dailyMediaUploadQuota,
  rollingWindowHours: contentCreationQuotaWindowHours
};

export function feedModeFromQuery(mode: string | undefined): FeedMode {
  return feedModes.has(mode ?? "") ? (mode as FeedMode) : "recommended";
}

export function feedSurfaceFromQuery(surface: string | undefined): FeedSurface {
  return feedSurfaces.has(surface ?? "") ? (surface as FeedSurface) : "home";
}

export function rawBodyBuffer(rawBody: unknown): Buffer {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }

  if (typeof rawBody === "string") {
    return Buffer.from(rawBody, "utf8");
  }

  return Buffer.alloc(0);
}

export function dailyQuotaWindowStart(
  now = new Date(),
  windowHours = contentCreationQuotaWindowHours
): Date {
  return new Date(now.getTime() - windowHours * 60 * 60 * 1000);
}

export function quotaExceededResponse(message: string): {
  code: "rate_limited";
  message: string;
} {
  return {
    code: "rate_limited",
    message
  };
}

export async function resolveContentCreationAbusePolicy(
  repository: ContentRepository
): Promise<ContentCreationAbusePolicy> {
  if (!repository.getContentCreationAbusePolicy) {
    return defaultContentCreationAbusePolicy;
  }

  const policy = await repository.getContentCreationAbusePolicy();

  return {
    dailyContentDraftQuota: positiveIntegerOrDefault(
      policy?.dailyContentDraftQuota,
      defaultContentCreationAbusePolicy.dailyContentDraftQuota
    ),
    dailyMediaUploadQuota: positiveIntegerOrDefault(
      policy?.dailyMediaUploadQuota,
      defaultContentCreationAbusePolicy.dailyMediaUploadQuota
    ),
    rollingWindowHours: positiveIntegerOrDefault(
      policy?.rollingWindowHours,
      defaultContentCreationAbusePolicy.rollingWindowHours
    )
  };
}

export async function withSignedPlayback(input: {
  content: components["schemas"]["ContentItem"];
  mediaUploadProvider: MediaUploadProviderAdapter;
  subscriptionRepository: SubscriptionRepository;
  supabaseUserId: string;
  appUserId: string;
}): Promise<components["schemas"]["ContentItem"]> {
  const { content, mediaUploadProvider } = input;
  const playback = content.playback;

  if (playback?.state === "full" && playback.provider === "livepeer") {
    return {
      ...content,
      playback: {
        state: "blocked",
        url: null,
        provider: "livepeer"
      }
    };
  }

  if (playback?.state !== "full" || playback.provider !== "bunny" || !playback.url) {
    return content;
  }

  const blockedPlayback: NonNullable<components["schemas"]["ContentItem"]["playback"]> = {
    state: "blocked",
    url: null,
    provider: "bunny"
  };

  const potentiallyAccounted =
    ["vod", "live_replay"].includes(content.mediaType) &&
    content.accessState === "free" &&
    content.creator.id !== input.appUserId;
  let usage: components["schemas"]["PlaybackUsageContext"] | undefined;

  if (potentiallyAccounted) {
    if (!input.subscriptionRepository.getPlatformPlaybackDecision) {
      return {
        ...content,
        playback: { ...blockedPlayback, blockReason: "provider_unavailable" }
      };
    }

    try {
      const decision = await input.subscriptionRepository.getPlatformPlaybackDecision({
        supabaseUserId: input.supabaseUserId,
        targetType: "content",
        targetId: content.id
      });
      if (decision.limitReached) {
        return {
          ...content,
          playback: { ...blockedPlayback, blockReason: "allowance_exhausted" }
        };
      }
      if (decision.countsTowardAllowance) {
        usage = {
          policy: "public_media_allowance",
          targetType: "content",
          targetId: content.id,
          heartbeatIntervalSeconds: 15
        };
      }
    } catch {
      return {
        ...content,
        playback: { ...blockedPlayback, blockReason: "provider_unavailable" }
      };
    }
  }

  if (!mediaUploadProvider.createPlaybackResource) {
    return {
      ...content,
      playback: blockedPlayback
    };
  }

  const providerAssetId = bunnyProviderAssetIdFromPlaybackUrl(playback.url);

  if (!providerAssetId) {
    return {
      ...content,
      playback: blockedPlayback
    };
  }

  try {
    return {
      ...content,
      playback: {
        ...mediaUploadProvider.createPlaybackResource({ providerAssetId }),
        ...(usage ? { usage } : {})
      }
    };
  } catch {
    return {
      ...content,
      playback: blockedPlayback
    };
  }
}

type AppReadyAccessResult =
  | {
      ok: true;
      supabaseUserId: string;
      appUserId: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: {
        code: string;
        message: string;
      };
    };

export async function verifyAppReadyAccess(
  request: FastifyRequest,
  options: RegisterContentRoutesOptions
): Promise<AppReadyAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const profile = await options.sessionRepository.findProfileBySupabaseUserId(
    verifiedSession.supabaseUserId
  );
  const [ageStatus, hasWallet] = await Promise.all([
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Protected content access requires profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId,
    appUserId: profile.id
  };
}

type CreatorCapability =
  | "canUploadMedia"
  | "canPublishMedia"
  | "canPublishAdultMedia"
  | "canMonetize";

export async function verifyCreatorCapability(
  supabaseUserId: string,
  capability: CreatorCapability,
  options: RegisterContentRoutesOptions
): Promise<
  | { ok: true }
  | {
      ok: false;
      statusCode: 403 | 503;
      body: {
        code: string;
        message: string;
        missingRequirements?: string[];
        nextBestAction?: string;
      };
    }
> {
  try {
    const resolution = await options.verificationRepository.resolveCapabilities({
      supabaseUserId
    });

    if (resolution.capabilities[capability]) {
      return { ok: true };
    }

    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "verification_required",
        message:
          capability === "canPublishAdultMedia"
            ? "Adult publisher verification is required for adult or explicit media."
            : capability === "canMonetize"
              ? "Identity, tax, and wallet readiness are required before earning."
              : "Age verification is required before publishing media.",
        missingRequirements: resolution.missingRequirements,
        nextBestAction: resolution.nextBestAction
      }
    };
  } catch (error) {
    if (error instanceof VerificationRepositoryConfigurationError) {
      return {
        ok: false,
        statusCode: 503,
        body: {
          code: "service_unavailable",
          message: "Verification status is not configured"
        }
      };
    }

    throw error;
  }
}

function bunnyProviderAssetIdFromPlaybackUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const providerAssetId = parsed.pathname
      .split("/")
      .map((part) => part.trim())
      .find((part) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(part)
      );

    return providerAssetId ?? null;
  } catch {
    return null;
  }
}

function positiveIntegerOrDefault(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}
