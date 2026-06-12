import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export interface ValidationErrorResponse {
  code: "validation_failed";
  message: string;
}

export function readIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER];
  const normalized = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  return normalized.length > 0 && normalized.length <= 255
    ? normalized
    : null;
}

export function idempotencyKeyValidationResponse(
  message = "Idempotency-Key header is required"
): ValidationErrorResponse {
  return {
    code: "validation_failed",
    message
  };
}

export function requireIdempotencyKey(
  request: FastifyRequest,
  message?: string
): ValidationErrorResponse | null {
  return readIdempotencyKey(request) ? null : idempotencyKeyValidationResponse(message);
}

export interface IdempotentMutationRequest {
  idempotencyKey: string;
  requestHash: string;
}

export function readIdempotentMutationRequest(
  request: FastifyRequest,
  body: unknown
): IdempotentMutationRequest | ValidationErrorResponse {
  const idempotencyKey = readIdempotencyKey(request);

  if (!idempotencyKey) {
    return idempotencyKeyValidationResponse();
  }

  return {
    idempotencyKey,
    requestHash: hashIdempotencyPayload(body)
  };
}

export function hashIdempotencyPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
  );
}
