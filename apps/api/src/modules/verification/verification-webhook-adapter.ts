import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type { NormalizedVerificationWebhook, VerificationProvider } from "./types.js";

export class VerificationWebhookConfigurationError extends Error {
  constructor(provider: VerificationProvider) {
    super(`VERIFICATION_WEBHOOK_NOT_CONFIGURED:${provider}`);
    this.name = "VerificationWebhookConfigurationError";
  }
}

export class VerificationWebhookSignatureError extends Error {
  constructor(provider: VerificationProvider) {
    super(`VERIFICATION_WEBHOOK_SIGNATURE_INVALID:${provider}`);
    this.name = "VerificationWebhookSignatureError";
  }
}

export class VerificationWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationWebhookValidationError";
  }
}

export function normalizeVerificationWebhook(input: {
  provider: VerificationProvider;
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedVerificationWebhook {
  if (input.provider === "sumsub") return normalizeSumsubWebhook(input);
  if (input.provider === "didit") return normalizeDiditWebhook(input);
  if (input.provider === "persona") return normalizePersonaWebhook(input);
  if (input.provider === "veriff") return normalizeVeriffWebhook(input);

  throw new VerificationWebhookConfigurationError(input.provider);
}

function normalizeSumsubWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedVerificationWebhook {
  const secret = input.env.SUMSUB_WEBHOOK_SECRET;
  if (!secret) throw new VerificationWebhookConfigurationError("sumsub");

  const digest = headerValue(input.headers["x-payload-digest"]);
  const digestAlg = headerValue(input.headers["x-payload-digest-alg"]) ?? "HMAC_SHA256_HEX";
  if (!digest || !verifyDigest(digest, digestAlg, input.rawBody, secret)) {
    throw new VerificationWebhookSignatureError("sumsub");
  }

  const body = objectBody(input.body);
  const eventType = stringValue(body.type);
  const providerEventId = firstStringValue(body.correlationId, body.applicantId);
  const providerReference = firstStringValue(body.applicantId, body.externalUserId);
  if (!eventType || !providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Sumsub webhook is missing required identifiers");
  }

  const reviewResult = objectBody(body.reviewResult, true);
  const reviewAnswer = stringValue(reviewResult?.reviewAnswer);
  return {
    provider: "sumsub",
    providerEventId,
    providerReference,
    eventType,
    status: mapReviewState(eventType, reviewAnswer, stringValue(body.reviewStatus)),
    signatureHash: sha256Hex(digest),
    occurredAt: parseProviderDate(firstStringValue(body.createdAtMs, body.createdAt)),
    failureReasonCode: reviewAnswer === "RED" ? firstStringValue(reviewResult?.reviewRejectType, body.reviewStatus) : null
  };
}

function normalizeDiditWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedVerificationWebhook {
  const secret = input.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) throw new VerificationWebhookConfigurationError("didit");

  const signature = headerValue(input.headers["x-didit-signature"]) ?? headerValue(input.headers["didit-signature"]);
  if (!signature || !secureEqualHex(createHmac("sha256", secret).update(input.rawBody).digest("hex"), signature)) {
    throw new VerificationWebhookSignatureError("didit");
  }

  const body = objectBody(input.body);
  const data = objectBody(body.data, true);
  const eventType = firstStringValue(body.event, body.type) ?? "verification.updated";
  const providerReference = firstStringValue(body.session_id, body.verification_id, data?.id, data?.session_id);
  const providerEventId = firstStringValue(body.id, body.event_id, providerReference);
  if (!providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Didit webhook is missing required identifiers");
  }

  return {
    provider: "didit",
    providerEventId,
    providerReference,
    eventType,
    status: mapGenericState(firstStringValue(body.status, data?.status, data?.decision)),
    signatureHash: sha256Hex(signature),
    occurredAt: parseProviderDate(firstStringValue(body.created_at, body.timestamp, data?.created_at)),
    failureReasonCode: firstStringValue(body.reason, data?.reason, data?.failure_reason)
  };
}

function normalizePersonaWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedVerificationWebhook {
  const secret = input.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) throw new VerificationWebhookConfigurationError("persona");

  const signature = headerValue(input.headers["persona-signature"]) ?? headerValue(input.headers["Persona-Signature"]);
  if (!signature || !signature.includes(createHmac("sha256", secret).update(input.rawBody).digest("hex"))) {
    throw new VerificationWebhookSignatureError("persona");
  }

  const body = objectBody(input.body);
  const data = objectBody(body.data);
  const attributes = objectBody(data.attributes, true);
  const eventType = firstStringValue(body.name, body.type) ?? "inquiry.updated";
  const providerReference = firstStringValue(data.id, attributes?.["inquiry-id"], attributes?.["reference-id"]);
  const providerEventId = firstStringValue(body.id, providerReference);
  if (!providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Persona webhook is missing required identifiers");
  }

  return {
    provider: "persona",
    providerEventId,
    providerReference,
    eventType,
    status: mapGenericState(firstStringValue(attributes?.status, body.status, eventType)),
    signatureHash: sha256Hex(signature),
    occurredAt: parseProviderDate(firstStringValue(attributes?.["completed-at"], attributes?.["created-at"])),
    failureReasonCode: firstStringValue(attributes?.["failure-reason"], attributes?.["reviewer-comment"])
  };
}

function normalizeVeriffWebhook(input: {
  body: unknown;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  env: ServerEnv;
}): NormalizedVerificationWebhook {
  const secret = input.env.VERIFF_SHARED_SECRET;
  if (!secret) throw new VerificationWebhookConfigurationError("veriff");

  const signature = headerValue(input.headers["x-hmac-signature"]);
  if (!signature || !secureEqualHex(createHmac("sha256", secret).update(input.rawBody).digest("hex"), signature)) {
    throw new VerificationWebhookSignatureError("veriff");
  }

  const body = objectBody(input.body);
  const verification = objectBody(body.verification, true);
  const providerReference = firstStringValue(verification?.id, body.id);
  const providerEventId = firstStringValue(body.id, body.eventId, providerReference);
  const eventType = firstStringValue(body.action, body.eventType, body.status) ?? "verification.updated";
  if (!providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Veriff webhook is missing required identifiers");
  }

  return {
    provider: "veriff",
    providerEventId,
    providerReference,
    eventType,
    status: mapGenericState(firstStringValue(verification?.status, verification?.decision, body.status)),
    signatureHash: sha256Hex(signature),
    occurredAt: parseProviderDate(firstStringValue(body.createdAt, verification?.createdAt)),
    failureReasonCode: firstStringValue(verification?.reason, verification?.reasonCode)
  };
}

function verifyDigest(digest: string, digestAlg: string, rawBody: Buffer, secret: string): boolean {
  const algorithm = digestAlg === "HMAC_SHA1_HEX" ? "sha1" : digestAlg === "HMAC_SHA512_HEX" ? "sha512" : "sha256";
  return secureEqualHex(createHmac(algorithm, secret).update(rawBody).digest("hex"), digest);
}

function mapReviewState(eventType: string, answer: string | null, reviewStatus: string | null) {
  if (eventType === "applicantReviewed" && answer === "GREEN") return "valid";
  if (eventType === "applicantReviewed" && answer === "RED") return "blocked";
  if (reviewStatus === "completed" && answer === "GREEN") return "valid";
  return "pending";
}

function mapGenericState(value: string | null): NormalizedVerificationWebhook["status"] {
  const normalized = value?.toLowerCase();
  if (!normalized) return "pending";
  if (["approved", "verified", "completed", "passed", "success", "accept"].some((part) => normalized.includes(part))) return "valid";
  if (["declined", "rejected", "failed", "abandoned", "expired"].some((part) => normalized.includes(part))) return "blocked";
  return "pending";
}

function objectBody(input: unknown, optional?: false): Record<string, unknown>;
function objectBody(input: unknown, optional: true): Record<string, unknown> | null;
function objectBody(input: unknown, optional = false): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (optional) return null;
  throw new VerificationWebhookValidationError("Verification webhook payload must be a JSON object");
}

function stringValue(input: unknown): string | null {
  return typeof input === "string" && input.length > 0 ? input : null;
}

function firstStringValue(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate) return candidate;
  }
  return null;
}

function headerValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function parseProviderDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
