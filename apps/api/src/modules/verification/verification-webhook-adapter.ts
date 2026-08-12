import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import { verifyDiditV3Webhook } from "./didit-webhook.js";
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

  const signatureV2 = verifyDiditV3Webhook({ body: input.body, headers: input.headers, secret });
  if (!signatureV2) {
    throw new VerificationWebhookSignatureError("didit");
  }

  const body = objectBody(input.body);
  const data = objectBody(body.data, true);
  const decision = objectBody(body.decision, true);
  const eventType = firstStringValue(body.webhook_type, body.event, body.type) ?? "verification.updated";
  const providerReference = firstStringValue(
    body.session_id,
    body.verification_id,
    body.id,
    data?.id,
    data?.session_id,
    data?.verification_id
  );
  const providerEventId = firstStringValue(body.event_id, body.id, providerReference);
  if (!providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Didit webhook is missing required identifiers");
  }

  return {
    provider: "didit",
    providerEventId,
    providerReference,
    eventType,
    status: mapGenericState(firstStringValue(body.status, data?.status, data?.decision)),
    signatureHash: sha256Hex(signatureV2),
    occurredAt: parseProviderDate(firstStringValue(body.created_at, data?.created_at)) ?? parseUnixSeconds(body.created_at, body.timestamp),
    failureReasonCode: firstStringValue(body.reason, data?.reason, data?.failure_reason),
    identityEvidence: decision ? {
      documentApproved: hasApprovedDecision(decision.id_verifications),
      livenessApproved: hasApprovedDecision(decision.liveness_checks),
      faceMatchApproved: hasApprovedDecision(decision.face_matches)
    } : null
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
  if (!signature || !verifyPersonaSignature(signature, input.rawBody, secret)) {
    throw new VerificationWebhookSignatureError("persona");
  }

  const body = objectBody(input.body);
  const eventData = objectBody(body.data);
  const eventAttributes = objectBody(eventData.attributes, true);
  const payload = objectBody(eventAttributes?.payload, true);
  const payloadData = objectBody(payload?.data, true);
  const inquiryData = payloadData ?? eventData;
  const inquiryAttributes = objectBody(inquiryData.attributes, true) ?? eventAttributes;
  const eventType = firstStringValue(eventAttributes?.name, body.name, body.type) ?? "inquiry.updated";
  const providerReference = firstStringValue(
    inquiryData.id,
    inquiryAttributes?.id,
    inquiryAttributes?.["inquiry-id"],
    inquiryAttributes?.["reference-id"],
    eventData.id
  );
  const providerEventId = firstStringValue(eventData.id, body.id, providerReference);
  if (!providerEventId || !providerReference) {
    throw new VerificationWebhookValidationError("Persona webhook is missing required identifiers");
  }

  return {
    provider: "persona",
    providerEventId,
    providerReference,
    eventType,
    status: mapGenericState(firstStringValue(inquiryAttributes?.status, body.status, eventType)),
    signatureHash: sha256Hex(signature),
    occurredAt: parseProviderDate(firstStringValue(inquiryAttributes?.["completed-at"], inquiryAttributes?.["created-at"])),
    failureReasonCode: firstStringValue(inquiryAttributes?.["failure-reason"], inquiryAttributes?.["reviewer-comment"])
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
    status: mapVeriffState(firstStringValue(verification?.status, verification?.decision, body.status, verification?.code)),
    signatureHash: sha256Hex(signature),
    occurredAt: parseProviderDate(firstStringValue(body.createdAt, verification?.createdAt)),
    failureReasonCode: firstStringValue(verification?.reason, verification?.reasonCode)
  };
}

function verifyDigest(digest: string, digestAlg: string, rawBody: Buffer, secret: string): boolean {
  const algorithm = digestAlg === "HMAC_SHA1_HEX" ? "sha1" : digestAlg === "HMAC_SHA512_HEX" ? "sha512" : "sha256";
  return secureEqualHex(createHmac(algorithm, secret).update(rawBody).digest("hex"), digest);
}

function verifyPersonaSignature(signatureHeader: string, rawBody: Buffer, secret: string): boolean {
  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = parsed.get("t")?.[0];
  const signatures = parsed.get("v1") ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  return signatures.some((signature) => secureEqualHex(expected, signature));
}

function mapReviewState(eventType: string, answer: string | null, reviewStatus: string | null) {
  if (eventType === "applicantReviewed" && answer === "GREEN") return "valid";
  if (eventType === "applicantReviewed" && answer === "RED") return "blocked";
  if (reviewStatus === "completed" && answer === "GREEN") return "valid";
  return "pending";
}

function hasApprovedDecision(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => {
    const record = objectBody(entry, true);
    return firstStringValue(record?.status)?.toLowerCase() === "approved";
  });
}

function mapGenericState(value: string | null): NormalizedVerificationWebhook["status"] {
  const normalized = value?.toLowerCase();
  if (!normalized) return "pending";
  if (["approved", "verified", "completed", "passed", "success", "accept"].some((part) => normalized.includes(part))) return "valid";
  if (["declined", "rejected", "failed", "abandoned", "expired"].some((part) => normalized.includes(part))) return "blocked";
  return "pending";
}

function mapVeriffState(value: string | null): NormalizedVerificationWebhook["status"] {
  const normalized = value?.toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "9001" || normalized.includes("approved")) return "valid";
  if (normalized === "9102" || normalized.includes("declined") || normalized.includes("abandoned")) return "blocked";
  if (normalized.includes("resubmission")) return "pending";
  return mapGenericState(normalized);
}

function parseSignatureHeader(value: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of value.split(",")) {
    const [key, ...rest] = part.split("=");
    const trimmedKey = key?.trim();
    const trimmedValue = rest.join("=").trim();
    if (!trimmedKey || !trimmedValue) continue;
    const values = parsed.get(trimmedKey) ?? [];
    values.push(trimmedValue);
    parsed.set(trimmedKey, values);
  }

  return parsed;
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

function parseUnixSeconds(...values: unknown[]): Date | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000);
  }
  return null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
