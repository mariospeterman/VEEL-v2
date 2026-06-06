import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "@veel/config";

export class MediaWebhookConfigurationError extends Error {
  constructor(provider: MediaWebhookProvider) {
    super(`MEDIA_WEBHOOK_NOT_CONFIGURED:${provider}`);
    this.name = "MediaWebhookConfigurationError";
  }
}

export class MediaWebhookSignatureError extends Error {
  constructor(provider: MediaWebhookProvider) {
    super(`MEDIA_WEBHOOK_SIGNATURE_INVALID:${provider}`);
    this.name = "MediaWebhookSignatureError";
  }
}

export class MediaWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaWebhookValidationError";
  }
}

export type MediaWebhookProvider = "bunny" | "livepeer";

export interface NormalizedMediaWebhook {
  provider: MediaWebhookProvider;
  providerEventId: string;
  providerAssetId: string;
  eventType: string;
  providerState: string;
  providerPlayable: boolean;
  signatureHash: string | null;
}

export function normalizeMediaWebhook(input: {
  provider: MediaWebhookProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedMediaWebhook {
  if (input.provider === "bunny") {
    return normalizeBunnyWebhook(input);
  }

  throw new MediaWebhookConfigurationError(input.provider);
}

function normalizeBunnyWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedMediaWebhook {
  const secret = input.env.BUNNY_STREAM_WEBHOOK_READONLY_KEY;

  if (!secret) {
    throw new MediaWebhookConfigurationError("bunny");
  }

  const signature = headerValue(input.headers["x-bunnystream-signature"]);
  const version = headerValue(input.headers["x-bunnystream-signature-version"]);
  const algorithm = headerValue(input.headers["x-bunnystream-signature-algorithm"]);

  if (!signature || !verifyBunnySignature({ rawBody: input.rawBody, secret, signature, version, algorithm })) {
    throw new MediaWebhookSignatureError("bunny");
  }

  const body = objectBody(input.body);
  const providerAssetId = stringValue(body.VideoGuid) ?? stringValue(body.videoGuid);
  const status = numberValue(body.Status ?? body.status);
  const libraryId = stringValue(body.VideoLibraryId) ?? stringValue(body.videoLibraryId);

  if (!providerAssetId || status === null) {
    throw new MediaWebhookValidationError("Bunny webhook is missing VideoGuid or Status");
  }

  const mapped = mapBunnyStatus(status);

  return {
    provider: "bunny",
    providerEventId: [libraryId, providerAssetId, String(status)].filter(Boolean).join(":"),
    providerAssetId,
    eventType: `video.status.${status}`,
    providerState: mapped.providerState,
    providerPlayable: mapped.providerPlayable,
    signatureHash: sha256Hex(signature)
  };
}

function verifyBunnySignature(input: {
  rawBody: Buffer;
  secret: string;
  signature: string;
  version: string | null;
  algorithm: string | null;
}): boolean {
  if (input.version !== "v1" || input.algorithm !== "hmac-sha256") {
    return false;
  }

  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  return secureEqualHex(expected, input.signature);
}

function mapBunnyStatus(status: number): { providerState: string; providerPlayable: boolean } {
  if (status === 3 || status === 4) {
    return { providerState: "ready", providerPlayable: true };
  }

  if (status === 5 || status === 8) {
    return { providerState: "failed", providerPlayable: false };
  }

  return { providerState: "processing", providerPlayable: false };
}

function objectBody(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  throw new MediaWebhookValidationError("Media webhook payload must be a JSON object");
}

function stringValue(input: unknown): string | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return String(input);
  }

  return typeof input === "string" && input.length > 0 ? input : null;
}

function numberValue(input: unknown): number | null {
  if (typeof input === "number" && Number.isInteger(input)) {
    return input;
  }

  if (typeof input === "string" && /^-?\d+$/.test(input)) {
    return Number(input);
  }

  return null;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function secureEqualHex(expected: string, received: string): boolean {
  if (!/^[0-9a-f]+$/i.test(received) || expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
