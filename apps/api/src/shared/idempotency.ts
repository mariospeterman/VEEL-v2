import type { FastifyRequest } from "fastify";

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export interface ValidationErrorResponse {
  code: "validation_failed";
  message: string;
}

export function readIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER];
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0
    ? idempotencyKey
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
