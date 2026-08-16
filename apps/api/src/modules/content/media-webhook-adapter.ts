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
  livepeerStream?: {
    providerStreamId: string;
    providerPlaybackId: string | null;
    roomState: "waiting" | "live" | "ended" | "replay_ready";
    playbackUrl: string | null;
  };
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

  if (input.provider === "livepeer") {
    return normalizeLivepeerWebhook(input);
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

function normalizeLivepeerWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedMediaWebhook {
  const secret = input.env.LIVEPEER_WEBHOOK_SECRET;

  if (!secret) {
    throw new MediaWebhookConfigurationError("livepeer");
  }

  const signatureHeader = headerValue(input.headers["livepeer-signature"]);
  const parsedSignature = parseLivepeerSignature(signatureHeader);

  if (
    !parsedSignature ||
    !verifyLivepeerSignature({ rawBody: input.rawBody, secret, signature: parsedSignature.v1 }) ||
    !isRecentLivepeerTimestamp(parsedSignature.timestamp)
  ) {
    throw new MediaWebhookSignatureError("livepeer");
  }

  const body = objectBody(input.body);
  const eventType = stringValue(body.event);
  const eventObject = objectValue(body.event_object) ?? objectValue(body.eventObject);
  const providerStreamId = stringValue(eventObject?.id) ?? stringValue(eventObject?.streamId);

  if (!eventType || !eventObject || !providerStreamId) {
    throw new MediaWebhookValidationError("Livepeer webhook is missing event or stream id");
  }

  const mapped = mapLivepeerStreamEvent(eventType);
  if (!mapped) {
    throw new MediaWebhookValidationError("Unsupported Livepeer live event type");
  }
  if (String(body.timestamp ?? "") !== String(parsedSignature.timestamp)) {
    throw new MediaWebhookSignatureError("livepeer");
  }
  const providerPlaybackId = stringValue(eventObject.playbackId) ?? stringValue(eventObject.playback_id);

  return {
    provider: "livepeer",
    providerEventId: [
      stringValue(body.webhookId),
      eventType,
      providerStreamId,
      String(parsedSignature.timestamp)
    ]
      .filter(Boolean)
      .join(":"),
    providerAssetId: providerStreamId,
    eventType,
    providerState: mapped.providerState,
    providerPlayable: mapped.roomState === "live",
    signatureHash: sha256Hex(parsedSignature.v1.join(",")),
    livepeerStream: {
      providerStreamId,
      providerPlaybackId,
      roomState: mapped.roomState,
      playbackUrl: playbackUrlFromLivepeerPlaybackId(providerPlaybackId)
    }
  };
}

function verifyLivepeerSignature(input: { rawBody: Buffer; secret: string; signature: string[] }): boolean {
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  return input.signature.some((signature) => secureEqualHex(expected, signature));
}

function parseLivepeerSignature(header: string | null): { timestamp: number; v1: string[] } | null {
  if (!header) {
    return null;
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) {
      if (key.trim() === "t") timestamp = Number(value.trim());
      if (key.trim() === "v1") signatures.push(value.trim());
    }
  }

  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    return null;
  }

  return { timestamp: timestamp as number, v1: signatures };
}

function isRecentLivepeerTimestamp(timestamp: number): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestamp) <= 5 * 60;
}

function mapLivepeerStreamEvent(eventType: string): {
  providerState: string;
  roomState: "waiting" | "live" | "ended" | "replay_ready";
} | null {
  if (eventType === "stream.started") {
    return { providerState: "active", roomState: "live" };
  }

  if (eventType === "recording.ready") {
    return { providerState: "recording_ready", roomState: "replay_ready" };
  }

  if (eventType === "stream.idle" || eventType === "recording.waiting") {
    return { providerState: "idle", roomState: "ended" };
  }

  return null;
}

function playbackUrlFromLivepeerPlaybackId(playbackId: string | null): string | null {
  return playbackId ? `https://livepeercdn.studio/hls/${playbackId}/index.m3u8` : null;
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

function objectValue(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
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
