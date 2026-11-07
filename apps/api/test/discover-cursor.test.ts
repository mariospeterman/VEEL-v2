import { describe, expect, it } from "vitest";
import {
  decodeContentCursor,
  decodeCreatorCursor,
  decodeEventCursor,
  decodeHashtagCursor,
  decodeLiveCursor,
  encodeContentCursor,
  encodeCreatorCursor,
  encodeEventCursor,
  encodeHashtagCursor,
  encodeLiveCursor,
  InvalidDiscoverCursorError
} from "../src/modules/discover/discover-cursor.js";
import { bindCursorScope } from "../src/shared/keyset-pagination.js";

const firstId = "00000000-0000-4000-8000-000000000101";
const secondId = "00000000-0000-4000-8000-000000000102";
const timestamp = new Date("2026-11-04T12:30:00.000Z");
const binding = bindCursorScope("GET /v1/discover/search", {
  actor: "actor-one",
  query: "studio",
  sort: "fixture"
});

describe("discover cursors", () => {
  it("round-trips each group-specific deterministic keyset", () => {
    expect(decodeContentCursor(
      encodeContentCursor(timestamp, firstId, binding),
      binding
    )).toEqual({
      createdAt: "2026-11-04T12:30:00.000000Z",
      id: firstId
    });
    expect(decodeCreatorCursor(
      encodeCreatorCursor("creator_one", firstId, binding),
      binding
    )).toEqual({
      handle: "creator_one",
      id: firstId
    });
    expect(decodeHashtagCursor(encodeHashtagCursor("studio", binding), binding))
      .toEqual({ slug: "studio" });
    expect(decodeEventCursor(
      encodeEventCursor(timestamp, secondId, binding),
      binding
    )).toEqual({
      startsAt: "2026-11-04T12:30:00.000000Z",
      id: secondId
    });
    expect(decodeLiveCursor(
      encodeLiveCursor(timestamp, secondId, binding),
      binding
    )).toEqual({
      createdAt: "2026-11-04T12:30:00.000000Z",
      id: secondId
    });
  });

  it("rejects legacy raw values and cross-group cursor reuse before SQL casts", () => {
    const contentCursor = encodeContentCursor(timestamp, firstId, binding);
    const liveCursor = encodeLiveCursor(timestamp, secondId, binding);

    expect(() => decodeLiveCursor(contentCursor, binding)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeContentCursor(liveCursor, binding)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeLiveCursor(timestamp.toISOString(), binding)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeContentCursor(firstId, binding)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeHashtagCursor("not-base64!".repeat(80), binding))
      .toThrow(InvalidDiscoverCursorError);
  });

  it("rejects account or normalized-filter binding changes", () => {
    const cursor = encodeContentCursor(timestamp, firstId, binding);
    const otherBinding = bindCursorScope("GET /v1/discover/search", {
      actor: "actor-two",
      query: "studio",
      sort: "fixture"
    });

    expect(() => decodeContentCursor(cursor, otherBinding))
      .toThrow(InvalidDiscoverCursorError);
  });
});
