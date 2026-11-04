import { createHash, createHmac } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreateMediaPlaybackResourceInput,
  CreateMediaProviderAssetInput,
  CreateMediaUploadProviderSessionInput,
  CreateMediaUploadSessionForProviderAssetInput,
  GetMediaPlaybackProviderDataInput,
  MediaUploadProviderAdapter,
  MediaPlaybackProviderData,
  MediaUploadProviderSession
} from "./types.js";

const bunnyStreamBaseUrl = "https://video.bunnycdn.com";
const bunnyTusUploadUrl = "https://video.bunnycdn.com/tusupload";
const bunnyEmbedBaseUrl = "https://iframe.mediadelivery.net/embed";
const defaultUploadTtlSeconds = 24 * 60 * 60;
const minimumUploadTtlSeconds = 60 * 60;

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
  const createProviderAsset = async (input: CreateMediaProviderAssetInput) => {
    const apiKey = env.BUNNY_STREAM_API_KEY;
    const libraryId = env.BUNNY_STREAM_LIBRARY_ID;
    if (!apiKey || !libraryId) throw new MediaUploadProviderConfigurationError();

    const response = await fetchImpl(`${bunnyStreamBaseUrl}/library/${libraryId}/videos`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        AccessKey: apiKey
      },
      body: JSON.stringify({ title: input.title })
    });
    if (!response.ok) throw new MediaUploadProviderError();
    const video = (await response.json()) as BunnyCreateVideoResponse;
    if (!video.guid) throw new MediaUploadProviderError();
    return { provider: "bunny" as const, providerAssetId: video.guid };
  };

  const createUploadSessionForProviderAsset = async (
    input: CreateMediaUploadSessionForProviderAssetInput
  ): Promise<MediaUploadProviderSession> => {
    const apiKey = env.BUNNY_STREAM_API_KEY;
    const libraryId = env.BUNNY_STREAM_LIBRARY_ID;
    if (!apiKey || !libraryId) throw new MediaUploadProviderConfigurationError();

    const uploadTtlSeconds = input.ttlSeconds === undefined
      ? defaultUploadTtlSeconds
      : Math.max(minimumUploadTtlSeconds, Math.min(defaultUploadTtlSeconds, input.ttlSeconds));
    const expirationTime = Math.floor(Date.now() / 1000) + uploadTtlSeconds;
    const signature = createHash("sha256")
      .update(`${libraryId}${apiKey}${expirationTime}${input.providerAssetId}`)
      .digest("hex");
    return {
      provider: "bunny",
      providerAssetId: input.providerAssetId,
      uploadUrl: bunnyTusUploadUrl,
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expirationTime),
        LibraryId: libraryId,
        VideoId: input.providerAssetId
      },
      expiresAt: new Date(expirationTime * 1000)
    };
  };

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
      const objectName = input.uploadAttemptId
        ? `${input.mediaAssetId}/${input.uploadAttemptId}`
        : input.mediaAssetId;
      return `images/${input.contentId}/${objectName}.${input.extension}`;
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
    async deleteProviderAsset(input) {
      if (input.assetKind === "image") {
        const accessKey = env.BUNNY_STORAGE_ACCESS_KEY;
        const zoneName = env.BUNNY_STORAGE_ZONE_NAME;
        const endpoint = env.BUNNY_STORAGE_API_ENDPOINT;
        if (!env.BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED || !accessKey || !zoneName || !endpoint) {
          throw new MediaUploadProviderConfigurationError();
        }
        const deleteUrl = new URL(
          `${encodeURIComponent(zoneName)}/${encodedObjectPath(input.providerAssetId)}`,
          withTrailingSlash(endpoint)
        );
        const response = await fetchImpl(deleteUrl, {
          method: "DELETE",
          headers: { AccessKey: accessKey }
        });
        if (response.status !== 200 && response.status !== 404) {
          throw new MediaUploadProviderError();
        }
        return;
      }

      const apiKey = env.BUNNY_STREAM_API_KEY;
      const libraryId = env.BUNNY_STREAM_LIBRARY_ID;
      if (!apiKey || !libraryId) {
        throw new MediaUploadProviderConfigurationError();
      }
      const response = await fetchImpl(
        `https://video.bunnycdn.com/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(input.providerAssetId)}`,
        { method: "DELETE", headers: { AccessKey: apiKey } }
      );
      if (response.status !== 200 && response.status !== 404) {
        throw new MediaUploadProviderError();
      }
    },
    async createUploadSession(
      input: CreateMediaUploadProviderSessionInput
    ): Promise<MediaUploadProviderSession> {
      const created = await createProviderAsset({ title: input.title });
      return createUploadSessionForProviderAsset({
        providerAssetId: created.providerAssetId,
        ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds })
      });
    },
    createProviderAsset,
    createUploadSessionForProviderAsset,
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
    createImageDeliveryResource(input) {
      const pullZoneUrl = env.BUNNY_STORAGE_PULL_ZONE_URL;
      const tokenKey = env.BUNNY_STORAGE_PULL_ZONE_TOKEN_KEY;
      if (
        !env.BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED ||
        !pullZoneUrl ||
        !tokenKey ||
        !isPrivateImageObjectReference(input.providerAssetId)
      ) {
        throw new MediaUploadProviderConfigurationError();
      }
      const deliveryTtlSeconds = Math.max(
        60,
        Math.min(3_600, env.BUNNY_STORAGE_DELIVERY_TOKEN_TTL_SECONDS ?? 300)
      );
      const expires = Math.floor((input.now?.getTime() ?? Date.now()) / 1000) +
        deliveryTtlSeconds;
      const original = signedImageUrl({
        pullZoneUrl,
        tokenKey,
        providerAssetId: input.providerAssetId,
        expires
      });
      return {
        url: original,
        expiresAt: new Date(expires * 1000).toISOString(),
        variants: [480, 960, 1440].map((widthPixels) => ({
          widthPixels,
          url: signedImageUrl({
            pullZoneUrl,
            tokenKey,
            providerAssetId: input.providerAssetId,
            expires,
            widthPixels
          })
        }))
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

function isPrivateImageObjectReference(value: string): boolean {
  return value.startsWith("images/") &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function signedImageUrl(input: {
  pullZoneUrl: string;
  tokenKey: string;
  providerAssetId: string;
  expires: number;
  widthPixels?: number;
}): string {
  const deliveryUrl = new URL(
    encodedObjectPath(input.providerAssetId),
    withTrailingSlash(input.pullZoneUrl)
  );
  const signingData = input.widthPixels ? `width=${input.widthPixels}` : "";
  const token = `HS256-${createHmac("sha256", input.tokenKey)
    .update(`${deliveryUrl.pathname}${input.expires}${signingData}`)
    .digest("base64url")}`;
  deliveryUrl.searchParams.set("token", token);
  deliveryUrl.searchParams.set("expires", String(input.expires));
  if (input.widthPixels) deliveryUrl.searchParams.set("width", String(input.widthPixels));
  return deliveryUrl.toString();
}
