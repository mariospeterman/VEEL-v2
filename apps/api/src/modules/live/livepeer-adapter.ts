import { signAccessJwt } from "@livepeer/core/crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreatedLiveProviderRoom,
  LiveProviderAdapter,
  LiveProviderRoomHealth,
  LiveProviderRoomStatus
} from "./types.js";

const livepeerRtmpIngestBaseUrl = "rtmp://rtmp.livepeer.com/live";

export class LiveProviderError extends Error {}

export class LiveProviderConfigurationError extends LiveProviderError {
  constructor() {
    super("LIVEPEER_NOT_CONFIGURED");
    this.name = "LiveProviderConfigurationError";
  }
}

export class LiveProviderRequestError extends LiveProviderError {
  constructor(
    readonly kind: "timeout" | "authentication" | "not_found" | "rate_limited" | "provider",
    readonly statusCode: number | null,
    readonly retryable: boolean
  ) {
    super(`LIVEPEER_${kind.toUpperCase()}`);
    this.name = "LiveProviderRequestError";
  }
}

interface LivepeerStreamResponse {
  id?: string;
  streamKey?: string;
  playbackId?: string;
  isActive?: boolean;
  lastTerminatedAt?: number | null;
  record?: boolean;
  suspended?: boolean;
  lastSeen?: number;
  isHealthy?: boolean;
}

interface LivepeerPlaybackResponse {
  type?: "live" | "vod" | "recording";
  meta?: {
    live?: number;
    source?: Array<{ type?: string; url?: string }>;
    dvrPlayback?: Array<{ url?: string; error?: string }>;
  };
}

export function createLivepeerProviderAdapter(
  env: ServerEnv,
  fetchImpl: typeof fetch = fetch
): LiveProviderAdapter {
  return {
    isConfigured() {
      return Boolean(
        (env.NODE_ENV !== "production" || env.MEDIA_MODERATION_MODE === "launch_approved") &&
        env.LIVEPEER_API_KEY &&
          env.LIVEPEER_WEBHOOK_SECRET &&
          env.LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY &&
          env.LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY &&
          env.LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID &&
          env.LIVEPEER_WEBHOOK_ID
      );
    },
    async createRoom(input) {
      const apiKey = env.LIVEPEER_API_KEY;

      if (!apiKey) {
        throw new LiveProviderConfigurationError();
      }

      const response = await livepeerFetch(env, fetchImpl, "/stream", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: input.title,
          playbackPolicy: { type: "jwt" },
          record: true,
          multistream: {
            targets: [
              {
                id: env.LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID,
                profile: "source"
              }
            ]
          },
          userTags: {
            veelRoomId: input.roomId
          }
        })
      });

      const payload = (await response.json()) as LivepeerStreamResponse;

      if (!payload.id || !payload.streamKey) {
        throw new LiveProviderConfigurationError();
      }

      return {
        provider: "livepeer",
        providerStreamId: payload.id,
        providerPlaybackId: payload.playbackId ?? null,
        providerState: payload.isActive ? "active" : "created",
        hostIngestUrl: `${livepeerRtmpIngestBaseUrl}/${payload.streamKey}`,
        hostStreamKey: payload.streamKey,
        playbackUrl: playbackUrlFromPlaybackId(payload.playbackId),
        moderationTargetReference: env.LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID ?? ""
      } satisfies CreatedLiveProviderRoom;
    },
    async getRoomStatus(input) {
      const apiKey = env.LIVEPEER_API_KEY;

      if (!apiKey) {
        throw new LiveProviderConfigurationError();
      }

      const streamResponse = await livepeerFetch(
        env,
        fetchImpl,
        `/stream/${encodeURIComponent(input.providerStreamId)}`,
        {
          headers: {
            authorization: `Bearer ${apiKey}`
          }
        }
      );

      const stream = (await streamResponse.json()) as LivepeerStreamResponse;
      const providerPlaybackId = stream.playbackId ?? input.providerPlaybackId;
      const playbackUrl = providerPlaybackId
        ? await findPlaybackUrl(env, fetchImpl, apiKey, providerPlaybackId)
        : null;
      const isActive = Boolean(stream.isActive);
      const state: LiveProviderRoomStatus["state"] = stream.suspended
        ? "suspended"
        : isActive
          ? "live"
          : stream.lastTerminatedAt
            ? "ended"
            : "waiting";

      return {
        providerStreamId: stream.id ?? input.providerStreamId,
        providerPlaybackId,
        providerState: stream.suspended ? "suspended" : isActive ? "active" : "idle",
        state,
        playbackUrl: stream.suspended ? null : playbackUrl
      };
    },
    async getRoomHealth(input) {
      const apiKey = env.LIVEPEER_API_KEY;
      if (!apiKey) throw new LiveProviderConfigurationError();

      const response = await livepeerFetch(
        env,
        fetchImpl,
        `/stream/${encodeURIComponent(input.providerStreamId)}`,
        { headers: { authorization: `Bearer ${apiKey}` } }
      );
      const stream = (await response.json()) as LivepeerStreamResponse;
      const lastSeenAt = livepeerLastSeenAt(stream.lastSeen);
      const recent = lastSeenAt !== null &&
        input.observedAt.getTime() - lastSeenAt.getTime() <= 90_000 &&
        lastSeenAt.getTime() <= input.observedAt.getTime() + 30_000;
      const reason: LiveProviderRoomHealth["reason"] = stream.suspended
        ? "suspended"
        : stream.isActive !== true
          ? "inactive"
          : stream.isHealthy !== true
            ? "unhealthy"
            : !recent
              ? "stale"
              : "healthy";

      return {
        providerStreamId: stream.id ?? input.providerStreamId,
        healthy: reason === "healthy",
        reason,
        observedAt: input.observedAt
      };
    },
    async createPlaybackJwt(input) {
      if (
        !env.LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY ||
        !env.LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY
      ) {
        return null;
      }

      try {
        return await signAccessJwt({
          privateKey: env.LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY,
          publicKey: env.LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY,
          issuer: env.API_URL,
          playbackId: input.playbackId,
          expiration: 5 * 60,
          custom: { userId: input.appUserId }
        });
      } catch {
        throw new LiveProviderConfigurationError();
      }
    },
    async setRoomSuspended(input) {
      const apiKey = env.LIVEPEER_API_KEY;
      if (!apiKey) throw new LiveProviderConfigurationError();

      await livepeerFetch(env, fetchImpl, `/stream/${encodeURIComponent(input.providerStreamId)}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ suspended: input.suspended })
      });
    },
    async terminateRoom(input) {
      const apiKey = env.LIVEPEER_API_KEY;
      if (!apiKey) throw new LiveProviderConfigurationError();

      await livepeerFetch(
        env,
        fetchImpl,
        `/stream/${encodeURIComponent(input.providerStreamId)}/terminate`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${apiKey}` }
        }
      );
    }
  };
}

function livepeerLastSeenAt(value: number | undefined): Date | null {
  if (!Number.isFinite(value)) return null;
  const milliseconds = (value as number) < 10_000_000_000 ? (value as number) * 1000 : value as number;
  const observedAt = new Date(milliseconds);
  return Number.isNaN(observedAt.getTime()) ? null : observedAt;
}

async function findPlaybackUrl(
  env: ServerEnv,
  fetchImpl: typeof fetch,
  apiKey: string,
  playbackId: string
): Promise<string | null> {
  let response: Response;
  try {
    response = await livepeerFetch(
      env,
      fetchImpl,
      `/playback/${encodeURIComponent(playbackId)}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    );
  } catch (error) {
    if (error instanceof LiveProviderRequestError && error.kind === "not_found") {
      return playbackUrlFromPlaybackId(playbackId);
    }
    throw error;
  }

  const payload = (await response.json()) as LivepeerPlaybackResponse;
  const sources = [...(payload.meta?.source ?? []), ...(payload.meta?.dvrPlayback ?? [])];
  const hls = sources.find((source) => source.url?.includes(".m3u8"));

  return hls?.url ?? playbackUrlFromPlaybackId(playbackId);
}

function playbackUrlFromPlaybackId(playbackId: string | undefined): string | null {
  return playbackId ? `https://livepeercdn.studio/hls/${playbackId}/index.m3u8` : null;
}

async function livepeerFetch(
  env: ServerEnv,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit
): Promise<Response> {
  const baseUrl = env.LIVEPEER_API_BASE_URL.replace(/\/$/, "");
  let response: Response;

  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(env.LIVEPEER_HTTP_TIMEOUT_MS)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new LiveProviderRequestError("timeout", null, true);
    }
    throw new LiveProviderRequestError("provider", null, true);
  }

  if (response.ok) {
    return response;
  }

  if (response.status === 401 || response.status === 403) {
    throw new LiveProviderRequestError("authentication", response.status, false);
  }
  if (response.status === 404) {
    throw new LiveProviderRequestError("not_found", response.status, false);
  }
  if (response.status === 429) {
    throw new LiveProviderRequestError("rate_limited", response.status, true);
  }

  throw new LiveProviderRequestError("provider", response.status, response.status >= 500);
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
