import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  idempotencyKeyValidationResponse,
  readIdempotencyKey,
  requireIdempotencyKey
} from "../src/shared/idempotency";

describe("idempotency helpers", () => {
  it("reads a string idempotency key from request headers", () => {
    expect(readIdempotencyKey(requestWithHeader("route-key-1"))).toBe("route-key-1");
  });

  it("ignores missing, empty, or repeated idempotency headers", () => {
    expect(readIdempotencyKey(requestWithHeaders({}))).toBeNull();
    expect(readIdempotencyKey(requestWithHeader(""))).toBeNull();
    expect(readIdempotencyKey(requestWithHeaders({ "idempotency-key": ["a", "b"] }))).toBeNull();
  });

  it("returns the standard validation response when a key is required", () => {
    expect(requireIdempotencyKey(requestWithHeaders({}))).toEqual({
      code: "validation_failed",
      message: "Idempotency-Key header is required"
    });
    expect(requireIdempotencyKey(requestWithHeader("route-key-2"))).toBeNull();
  });

  it("supports custom validation wording for legacy-compatible routes", () => {
    expect(idempotencyKeyValidationResponse("Missing Idempotency-Key header")).toEqual({
      code: "validation_failed",
      message: "Missing Idempotency-Key header"
    });
  });
});

function requestWithHeader(idempotencyKey: string): FastifyRequest {
  return requestWithHeaders({ "idempotency-key": idempotencyKey });
}

function requestWithHeaders(headers: Record<string, string | string[]>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}
