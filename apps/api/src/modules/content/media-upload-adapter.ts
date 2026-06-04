import { createHash } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreateMediaUploadProviderSessionInput,
  GetMediaPlaybackProviderDataInput,
  MediaUploadProviderAdapter,
  MediaPlaybackProviderData,
  MediaUploadProviderSession
} from "./types.js";

const bunnyStreamBaseUrl = "https://video.bunnycdn.com";
const bunnyTusUploadUrl = "https://video.bunnycdn.com/tusupload";
const uploadTtlSeconds = 24 * 60 * 60;

export class MediaUploadProviderConfigurationError extends Error {
  constructor() {
    super("MEDIA_UPLOAD_PROVIDER_NOT_CONFIGURED");
    this.name = "MediaUploadProviderConfigurationError";
  }
}

export class MediaUploadProviderError extends Error {
  constructor() {
    super("MEDIA_UPLOAD_PROVIDER_ERROR");
    this.name = "MediaUploadProviderError";
  }
}

interface BunnyCreateVideoResponse {
  guid?: string;
}

interface BunnyVideoPlayDataResponse {
  isPlayable?: boolean;
  isPlaylistPlayable?: boolean;
  videoPlaylistUrl?: string | null;
  thumbnailUrl?: string | null;
  video?: {
    length?: number | null;
  };
}

export function createBunnyStreamUploadAdapter(
  env: ServerEnv,
  fetchImpl: typeof fetch = fetch
): MediaUploadProviderAdapter {
  return {
    provider: "bunny",
    isConfigured() {
      return Boolean(env.BUNNY_STREAM_API_KEY && env.BUNNY_STREAM_LIBRARY_ID);
    },
    async createUploadSession(
      input: CreateMediaUploadProviderSessionInput
    ): Promise<MediaUploadProviderSession> {
      const apiKey = env.BUNNY_STREAM_API_KEY;
      const libraryId = env.BUNNY_STREAM_LIBRARY_ID;

      if (!apiKey || !libraryId) {
        throw new MediaUploadProviderConfigurationError();
      }

      const response = await fetchImpl(`${bunnyStreamBaseUrl}/library/${libraryId}/videos`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          AccessKey: apiKey
        },
        body: JSON.stringify({
          title: input.title
        })
      });

      if (!response.ok) {
        throw new MediaUploadProviderError();
      }

      const video = (await response.json()) as BunnyCreateVideoResponse;

      if (!video.guid) {
        throw new MediaUploadProviderError();
      }

      const expirationTime = Math.floor(Date.now() / 1000) + uploadTtlSeconds;
      const signature = createHash("sha256")
        .update(`${libraryId}${apiKey}${expirationTime}${video.guid}`)
        .digest("hex");

      return {
        provider: "bunny",
        providerAssetId: video.guid,
        uploadUrl: bunnyTusUploadUrl,
        headers: {
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expirationTime),
          LibraryId: libraryId,
          VideoId: video.guid
        },
        expiresAt: new Date(expirationTime * 1000)
      };
    },
    async getPlaybackData(
      input: GetMediaPlaybackProviderDataInput
    ): Promise<MediaPlaybackProviderData> {
      const apiKey = env.BUNNY_STREAM_API_KEY;
      const libraryId = env.BUNNY_STREAM_LIBRARY_ID;

      if (!apiKey || !libraryId) {
        throw new MediaUploadProviderConfigurationError();
      }

      const response = await fetchImpl(
        `${bunnyStreamBaseUrl}/library/${libraryId}/videos/${input.providerAssetId}/play`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            AccessKey: apiKey
          }
        }
      );

      if (!response.ok) {
        throw new MediaUploadProviderError();
      }

      const playData = (await response.json()) as BunnyVideoPlayDataResponse;
      const providerPlayable = Boolean(playData.isPlayable && playData.videoPlaylistUrl);

      return {
        providerState: providerPlayable ? "ready" : "processing",
        providerPlayable,
        playbackUrl: providerPlayable ? playData.videoPlaylistUrl ?? null : null,
        posterUrl: playData.thumbnailUrl ?? null,
        durationMs:
          typeof playData.video?.length === "number" ? Math.round(playData.video.length * 1000) : null
      };
    }
  };
}
