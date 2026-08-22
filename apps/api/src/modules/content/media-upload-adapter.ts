import { createHash } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreateMediaPlaybackResourceInput,
  CreateMediaUploadProviderSessionInput,
  GetMediaPlaybackProviderDataInput,
  MediaUploadProviderAdapter,
  MediaPlaybackProviderData,
  MediaUploadProviderSession
} from "./types.js";

const bunnyStreamBaseUrl = "https://video.bunnycdn.com";
const bunnyTusUploadUrl = "https://video.bunnycdn.com/tusupload";
const bunnyEmbedBaseUrl = "https://iframe.mediadelivery.net/embed";
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

type BunnyStreamProviderConfig = Partial<ServerEnv>;

export function createBunnyStreamUploadAdapter(
  env: BunnyStreamProviderConfig,
  fetchImpl: typeof fetch = fetch
): MediaUploadProviderAdapter {
  return {
    provider: "bunny",
    isConfigured() {
      return Boolean(env.BUNNY_STREAM_API_KEY && env.BUNNY_STREAM_LIBRARY_ID);
    },
    isImageUploadConfigured() {
      return Boolean(
        env.BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED &&
        env.BUNNY_STORAGE_ACCESS_KEY &&
        env.BUNNY_STORAGE_ZONE_NAME &&
        env.BUNNY_STORAGE_API_ENDPOINT &&
        env.BUNNY_STORAGE_PULL_ZONE_URL &&
        env.BUNNY_STORAGE_PULL_ZONE_TOKEN_KEY
      );
    },
    createImageObjectReference(input) {
      return `images/${input.contentId}/${input.mediaAssetId}.${input.extension}`;
    },
    async uploadImageObject(input) {
      const accessKey = env.BUNNY_STORAGE_ACCESS_KEY;
      const zoneName = env.BUNNY_STORAGE_ZONE_NAME;
      const endpoint = env.BUNNY_STORAGE_API_ENDPOINT;

      if (!env.BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED || !accessKey || !zoneName || !endpoint) {
        throw new MediaUploadProviderConfigurationError();
      }

      const uploadUrl = new URL(
        `${encodeURIComponent(zoneName)}/${encodedObjectPath(input.providerAssetId)}`,
        withTrailingSlash(endpoint)
      );
      const response = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          AccessKey: accessKey,
          Checksum: input.checksumSha256.toUpperCase(),
          "Content-Type": input.mimeType
        },
        body: input.body.buffer.slice(
          input.body.byteOffset,
          input.body.byteOffset + input.body.byteLength
        ) as ArrayBuffer
      });

      if (response.status !== 201) {
        throw new MediaUploadProviderError();
      }
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
    createPlaybackResource(input: CreateMediaPlaybackResourceInput) {
      const tokenKey = env.BUNNY_STREAM_EMBED_TOKEN_KEY;
      const libraryId = env.BUNNY_STREAM_LIBRARY_ID;

      if (!tokenKey || !libraryId) {
        throw new MediaUploadProviderConfigurationError();
      }

      const expires =
        Math.floor((input.now?.getTime() ?? Date.now()) / 1000) +
        (env.BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS ?? 900);
      const token = createHash("sha256")
        .update(`${tokenKey}${input.providerAssetId}${expires}`)
        .digest("hex");

      return {
        state: "full",
        url: `${bunnyEmbedBaseUrl}/${libraryId}/${input.providerAssetId}?token=${token}&expires=${expires}`,
        provider: "bunny",
        resourceType: "embed",
        expiresAt: new Date(expires * 1000).toISOString()
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

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function encodedObjectPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}
