import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  hashIdempotencyPayload,
  idempotencyKeyValidationResponse,
  readIdempotencyKey,
  readIdempotentMutationRequest,
  requireIdempotencyKey
} from "../src/shared/idempotency";

describe("idempotency helpers", () => {
  it("reads a string idempotency key from request headers", () => {
    expect(readIdempotencyKey(requestWithHeader("route-key-1"))).toBe("route-key-1");
    expect(readIdempotencyKey(requestWithHeader(" route-key-1 "))).toBe("route-key-1");
  });

  it("ignores missing, empty, oversized, or repeated idempotency headers", () => {
    expect(readIdempotencyKey(requestWithHeaders({}))).toBeNull();
    expect(readIdempotencyKey(requestWithHeader(""))).toBeNull();
    expect(readIdempotencyKey(requestWithHeader(" ".repeat(4)))).toBeNull();
    expect(readIdempotencyKey(requestWithHeader("x".repeat(256)))).toBeNull();
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

  it("builds stable request hashes independent of object key insertion order", () => {
    expect(hashIdempotencyPayload({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashIdempotencyPayload({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it("returns a combined idempotent mutation request for route helpers", () => {
    const body = { b: 2, a: 1 };

    expect(readIdempotentMutationRequest(requestWithHeader("route-key-3"), body)).toEqual({
      idempotencyKey: "route-key-3",
      requestHash: hashIdempotencyPayload(body)
    });
    expect(readIdempotentMutationRequest(requestWithHeaders({}), body)).toEqual({
      code: "validation_failed",
      message: "Idempotency-Key header is required"
    });
  });
});

function requestWithHeader(idempotencyKey: string): FastifyRequest {
  return requestWithHeaders({ "idempotency-key": idempotencyKey });
}

function requestWithHeaders(headers: Record<string, string | string[]>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}
