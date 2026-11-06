import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

const defaultHttpTimeoutMs = 2 * 60 * 1000;
// The worker emits portable ustar archives. Its 12-byte size field can encode
// at most eleven octal digits plus NUL, so the provider must never admit a
// larger single source.
const maximumUstarSourceBytes = 8_589_934_591;
const defaultMaximumSourceBytes = maximumUstarSourceBytes;

export interface ContentExportProviderConfig {
  enabled: boolean;
  storageAccessKey?: string;
  storageZoneName?: string;
  storageApiEndpoint?: string;
  streamOriginalPullZoneUrl?: string;
  streamCdnTokenKey?: string;
  httpTimeoutMs?: number;
  maximumSourceBytes?: number;
}

export interface ContentExportSourceDescriptor {
  provider: "bunny" | "livepeer";
  providerObjectReference: string;
  assetKind: "image" | "video";
}

export type ContentExportSourceOpenResult =
  | {
      state: "available";
      byteLength: number;
      body: AsyncIterable<Uint8Array>;
    }
  | {
      state: "unavailable";
      reason:
        | "provider_original_export_not_supported"
        | "source_length_unavailable"
        | "source_not_retained"
        | "source_object_missing"
        | "source_provider_rejected"
        | "source_too_large";
    };

export interface ContentExportArchiveReadResult {
  byteLength: number | null;
  body: AsyncIterable<Uint8Array>;
}

export interface ContentExportProvider {
  openSource(input: ContentExportSourceDescriptor): Promise<ContentExportSourceOpenResult>;
  uploadArchive(input: {
    archiveObjectKey: string;
    body: AsyncIterable<Uint8Array>;
  }): Promise<void>;
  openArchive(input: { archiveObjectKey: string }): Promise<ContentExportArchiveReadResult>;
  /**
   * Intentionally not called by either the worker or API. Archive deletion is
   * an owner-approved operations action after quarantine evidence, never an
   * automatic consequence of TTL expiry.
   */
  deleteArchiveObject(input: { archiveObjectKey: string }): Promise<void>;
}

export class ContentExportProviderConfigurationError extends Error {
  constructor() {
    super("CONTENT_EXPORT_PROVIDER_NOT_CONFIGURED");
    this.name = "ContentExportProviderConfigurationError";
  }
}

export class ContentExportProviderTransientError extends Error {
  constructor(message = "CONTENT_EXPORT_PROVIDER_TRANSIENT_ERROR") {
    super(message);
    this.name = "ContentExportProviderTransientError";
  }
}

export function createBunnyContentExportProvider(
  config: ContentExportProviderConfig,
  fetchImpl: typeof fetch = fetch
): ContentExportProvider {
  const timeoutMs = boundedInteger(config.httpTimeoutMs, 1_000, 10 * 60 * 1000, defaultHttpTimeoutMs);
  const maximumSourceBytes = boundedInteger(
    config.maximumSourceBytes,
    1,
    maximumUstarSourceBytes,
    defaultMaximumSourceBytes
  );

  return {
    async openSource(input) {
      requireEnabled(config);
      if (input.provider !== "bunny") {
        return {
          state: "unavailable",
          reason: "provider_original_export_not_supported"
        };
      }

      if (input.assetKind === "image") {
        const response = await storageRequest(config, input.providerObjectReference, fetchImpl, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs)
        });
        return sourceResponse(response, maximumSourceBytes, "source_object_missing");
      }

      const pullZoneUrl = config.streamOriginalPullZoneUrl;
      const tokenKey = config.streamCdnTokenKey;
      if (!pullZoneUrl || !tokenKey) throw new ContentExportProviderConfigurationError();
      const originalUrl = new URL(
        `${encodeURIComponent(input.providerObjectReference)}/original`,
        withTrailingSlash(pullZoneUrl)
      );
      const signedUrl = signBunnyCdnUrl({
        url: originalUrl,
        tokenKey,
        expiresAt: Math.floor(Date.now() / 1000) + 5 * 60
      });
      const response = await fetchImpl(signedUrl, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs)
      }).catch(() => {
        throw new ContentExportProviderTransientError();
      });
      return sourceResponse(response, maximumSourceBytes, "source_not_retained");
    },

    async uploadArchive(input) {
      requireEnabled(config);
      assertArchiveObjectKey(input.archiveObjectKey);
      const response = await storageRequest(config, input.archiveObjectKey, fetchImpl, {
        method: "PUT",
        headers: { "Content-Type": "application/x-tar" },
        body: Readable.toWeb(Readable.from(input.body)) as BodyInit,
        signal: AbortSignal.timeout(timeoutMs),
        // Node fetch requires duplex for a streaming request body. This is a
        // runtime option, not a provider-specific payload field.
        duplex: "half"
      } as RequestInit & { duplex: "half" });
      if (response.status !== 201) throw new ContentExportProviderTransientError();
    },

    async openArchive(input) {
      requireEnabled(config);
      assertArchiveObjectKey(input.archiveObjectKey);
      const response = await storageRequest(config, input.archiveObjectKey, fetchImpl, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 404) throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_MISSING");
      if (!response.ok || !response.body) throw new ContentExportProviderTransientError();
      return {
        byteLength: parseContentLength(response.headers.get("content-length")),
        body: responseBody(response.body)
      };
    },

    async deleteArchiveObject(input) {
      requireEnabled(config);
      assertArchiveObjectKey(input.archiveObjectKey);
      const response = await storageRequest(config, input.archiveObjectKey, fetchImpl, {
        method: "DELETE",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status !== 200 && response.status !== 404) {
        throw new ContentExportProviderTransientError();
      }
    }
  };
}

export function signBunnyCdnUrl(input: {
  url: URL;
  tokenKey: string;
  expiresAt: number;
}): URL {
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new ContentExportProviderConfigurationError();
  }
  const signed = new URL(input.url);
  if (signed.search) throw new ContentExportProviderConfigurationError();
  const signaturePath = decodeURIComponent(signed.pathname);
  const token = `HS256-${createHmac("sha256", input.tokenKey)
    .update(`${signaturePath}${input.expiresAt}`)
    .digest("base64url")}`;
  signed.searchParams.set("token", token);
  signed.searchParams.set("expires", String(input.expiresAt));
  return signed;
}

async function storageRequest(
  config: ContentExportProviderConfig,
  objectKey: string,
  fetchImpl: typeof fetch,
  init: RequestInit
): Promise<Response> {
  const accessKey = config.storageAccessKey;
  const zoneName = config.storageZoneName;
  const endpoint = config.storageApiEndpoint;
  if (!accessKey || !zoneName || !endpoint) throw new ContentExportProviderConfigurationError();
  assertPrivateObjectKey(objectKey);
  const url = new URL(
    `${encodeURIComponent(zoneName)}/${encodedObjectPath(objectKey)}`,
    withTrailingSlash(endpoint)
  );
  const headers = new Headers(init.headers);
  headers.set("AccessKey", accessKey);
  // Never follow a provider-controlled redirect with the Storage AccessKey.
  return fetchImpl(url, { ...init, redirect: "error", headers }).catch(() => {
    throw new ContentExportProviderTransientError();
  });
}

function sourceResponse(
  response: Response,
  maximumSourceBytes: number,
  notFoundReason: "source_not_retained" | "source_object_missing"
): ContentExportSourceOpenResult {
  if (response.status === 404) return { state: "unavailable", reason: notFoundReason };
  if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new ContentExportProviderTransientError();
  }
  if (!response.ok || !response.body) {
    return { state: "unavailable", reason: "source_provider_rejected" };
  }
  const byteLength = parseContentLength(response.headers.get("content-length"));
  if (byteLength === null) return { state: "unavailable", reason: "source_length_unavailable" };
  if (byteLength > maximumSourceBytes) return { state: "unavailable", reason: "source_too_large" };
  return { state: "available", byteLength, body: responseBody(response.body) };
}

async function* responseBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requireEnabled(config: ContentExportProviderConfig): void {
  if (!config.enabled) throw new ContentExportProviderConfigurationError();
}

function assertArchiveObjectKey(value: string): void {
  if (!/^exports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.tar$/.test(value)) {
    throw new ContentExportProviderConfigurationError();
  }
}

function assertPrivateObjectKey(value: string): void {
  if (
    value.length === 0 ||
    value.length > 500 ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new ContentExportProviderConfigurationError();
  }
}

function encodedObjectPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fallback;
}
