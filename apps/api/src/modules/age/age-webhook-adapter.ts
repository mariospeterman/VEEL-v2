import { constants, createHash, createHmac, createVerify, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ServerEnv } from "@veel/config";
import type { AgeProvider, AgeState } from "./types.js";

export class AgeWebhookConfigurationError extends Error {
  constructor(provider: AgeProvider) {
    super(`AGE_WEBHOOK_NOT_CONFIGURED:${provider}`);
    this.name = "AgeWebhookConfigurationError";
  }
}

export class AgeWebhookSignatureError extends Error {
  constructor(provider: AgeProvider) {
    super(`AGE_WEBHOOK_SIGNATURE_INVALID:${provider}`);
    this.name = "AgeWebhookSignatureError";
  }
}

export class AgeWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgeWebhookValidationError";
  }
}

export interface NormalizedAgeWebhook {
  provider: AgeProvider;
  providerEventId: string;
  providerReference: string;
  eventType: string;
  state: Extract<AgeState, "pending" | "verified" | "failed">;
  signatureHash: string | null;
  occurredAt?: Date | null;
  failureCode?: string | null;
}

export function normalizeAgeWebhook(input: {
  provider: AgeProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedAgeWebhook {
  if (input.provider === "sumsub") {
    return normalizeSumsubWebhook(input);
  }

  if (input.provider === "yoti") {
    return normalizeYotiWebhook(input);
  }

  if (input.provider === "didit") {
    return normalizeDiditWebhook(input);
  }

  throw new AgeWebhookConfigurationError(input.provider);
}

function normalizeSumsubWebhook(input: {
  provider: AgeProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedAgeWebhook {
  const secret = input.env.SUMSUB_WEBHOOK_SECRET;

  if (!secret) {
    throw new AgeWebhookConfigurationError("sumsub");
  }

  const digest = headerValue(input.headers["x-payload-digest"]);
  const digestAlg = headerValue(input.headers["x-payload-digest-alg"]) ?? "HMAC_SHA256_HEX";

  if (!digest || !verifySumsubDigest({ digest, digestAlg, rawBody: input.rawBody, secret })) {
    throw new AgeWebhookSignatureError("sumsub");
  }

  const body = objectBody(input.body);
  const eventType = stringValue(body.type);
  const providerEventId = firstStringValue(body.correlationId, body.applicantId);
  const providerReference = firstStringValue(body.applicantId, body.externalUserId);

  if (!eventType || !providerEventId || !providerReference) {
    throw new AgeWebhookValidationError("Sumsub webhook is missing required event identifiers");
  }

  const reviewAnswer = objectBody(body.reviewResult, true)?.reviewAnswer;
  const state = mapSumsubState(eventType, stringValue(reviewAnswer), stringValue(body.reviewStatus));

  return {
    provider: "sumsub",
    providerEventId,
    providerReference,
    eventType,
    state,
    signatureHash: sha256Hex(digest),
    occurredAt: parseProviderDate(firstStringValue(body.createdAtMs, body.createdAt)),
    failureCode:
      state === "failed"
        ? firstStringValue(objectBody(body.reviewResult, true)?.reviewRejectType, body.reviewStatus, eventType)
        : null
  };
}

function normalizeYotiWebhook(input: {
  provider: AgeProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedAgeWebhook {
  if (!input.env.YOTI_NOTIFICATION_KEY_PATH) {
    throw new AgeWebhookConfigurationError("yoti");
  }

  const body = objectBody(input.body);
  const signature = stringValue(body.signature);

  if (!signature || !verifyYotiSignature(input.env.YOTI_NOTIFICATION_KEY_PATH, body, signature)) {
    throw new AgeWebhookSignatureError("yoti");
  }

  const providerEventId = stringValue(body.id);
  const providerReference = firstStringValue(body.session_key, body.reference_id);
  const eventType = stringValue(body.method) ?? "age_verification";
  const stateValue = stringValue(body.state);

  if (!providerEventId || !providerReference || !stateValue) {
    throw new AgeWebhookValidationError("Yoti webhook is missing required event identifiers");
  }

  return {
    provider: "yoti",
    providerEventId,
    providerReference,
    eventType,
    state: mapYotiState(stateValue),
    signatureHash: sha256Hex(signature),
    occurredAt: typeof body.timestamp === "number" ? new Date(body.timestamp * 1000) : null,
    failureCode: stateValue === "COMPLETE" ? null : stateValue
  };
}

function normalizeDiditWebhook(input: {
  provider: AgeProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedAgeWebhook {
  const secret = input.env.DIDIT_WEBHOOK_SECRET;

  if (!secret) {
    throw new AgeWebhookConfigurationError("didit");
  }

  const signatureV2 = headerValue(input.headers["x-signature-v2"]) ?? headerValue(input.headers["X-Signature-V2"]);
  const legacySignature = headerValue(input.headers["x-didit-signature"]) ?? headerValue(input.headers["didit-signature"]);

  if (!verifyDiditSignature(input.body, input.rawBody, secret, signatureV2, legacySignature)) {
    throw new AgeWebhookSignatureError("didit");
  }

  const body = objectBody(input.body);
  const data = objectBody(body.data, true);
  const eventType = firstStringValue(body.event, body.type) ?? "age_verification.updated";
  const providerReference = firstStringValue(
    body.session_id,
    body.verification_id,
    body.id,
    data?.id,
    data?.session_id,
    data?.verification_id
  );
  const providerEventId = firstStringValue(body.id, body.event_id, providerReference);

  if (!providerEventId || !providerReference) {
    throw new AgeWebhookValidationError("Didit webhook is missing required event identifiers");
  }

  const status = firstStringValue(body.status, data?.status, data?.decision, eventType);
  const state = mapDiditAgeState(status);

  return {
    provider: "didit",
    providerEventId,
    providerReference,
    eventType,
    state,
    signatureHash: sha256Hex(signatureV2 ?? legacySignature ?? ""),
    occurredAt: parseProviderDate(firstStringValue(body.created_at, body.timestamp, data?.created_at)),
    failureCode: state === "failed" ? firstStringValue(body.reason, data?.reason, data?.failure_reason, status) : null
  };
}

function verifySumsubDigest(input: {
  digest: string;
  digestAlg: string;
  rawBody: Buffer;
  secret: string;
}): boolean {
  const algorithm = sumsubDigestAlgorithm(input.digestAlg);
  const expected = createHmac(algorithm, input.secret).update(input.rawBody).digest("hex");
  return secureEqualHex(expected, input.digest);
}

function sumsubDigestAlgorithm(digestAlg: string): "sha1" | "sha256" | "sha512" {
  if (digestAlg === "HMAC_SHA1_HEX") {
    return "sha1";
  }

  if (digestAlg === "HMAC_SHA512_HEX") {
    return "sha512";
  }

  return "sha256";
}

function verifyYotiSignature(publicKeyPath: string, body: Record<string, unknown>, signature: string): boolean {
  const { sequence_number: _sequenceNumber, signature: _signature, ...payload } = body;
  const payloadString = JSON.stringify(payload).replace(/\s/g, "");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(payloadString);
  verifier.end();

  try {
    return verifier.verify(
      {
        key: readFileSync(publicKeyPath, "utf8"),
        padding: constants.RSA_PKCS1_PSS_PADDING
      },
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

function verifyDiditSignature(
  body: unknown,
  rawBody: Buffer,
  secret: string,
  signatureV2: string | null,
  legacySignature: string | null
): boolean {
  if (signatureV2) {
    return secureEqualHex(createHmac("sha256", secret).update(canonicalJson(body)).digest("hex"), signatureV2);
  }

  return Boolean(
    legacySignature && secureEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), legacySignature)
  );
}

function mapSumsubState(
  eventType: string,
  reviewAnswer: string | null,
  reviewStatus: string | null
): Extract<AgeState, "pending" | "verified" | "failed"> {
  if (eventType === "applicantReviewed" && reviewAnswer === "GREEN") {
    return "verified";
  }

  if (eventType === "applicantReviewed" && reviewAnswer === "RED") {
    return "failed";
  }

  if (reviewStatus === "completed" && reviewAnswer === "GREEN") {
    return "verified";
  }

  return "pending";
}

function mapYotiState(state: string): Extract<AgeState, "pending" | "verified" | "failed"> {
  if (state === "COMPLETE") {
    return "verified";
  }

  if (state === "FAIL" || state === "ERROR") {
    return "failed";
  }

  return "pending";
}

function mapDiditAgeState(value: string | null): Extract<AgeState, "pending" | "verified" | "failed"> {
  const normalized = value?.toLowerCase();
  if (!normalized) return "pending";
  if (["approved", "verified", "completed", "passed", "success"].some((part) => normalized.includes(part))) {
    return "verified";
  }
  if (["declined", "rejected", "failed", "abandoned", "expired"].some((part) => normalized.includes(part))) {
    return "failed";
  }
  return "pending";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function objectBody(input: unknown, optional?: false): Record<string, unknown>;
function objectBody(input: unknown, optional: true): Record<string, unknown> | null;
function objectBody(input: unknown, optional = false): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (optional) {
    return null;
  }

  throw new AgeWebhookValidationError("Age webhook payload must be a JSON object");
}

function stringValue(input: unknown): string | null {
  return typeof input === "string" && input.length > 0 ? input : null;
}

function firstStringValue(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = stringValue(value);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function parseProviderDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
