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

const firstId = "00000000-0000-4000-8000-000000000101";
const secondId = "00000000-0000-4000-8000-000000000102";
const timestamp = new Date("2026-11-04T12:30:00.000Z");

describe("discover cursors", () => {
  it("round-trips each group-specific deterministic keyset", () => {
    expect(decodeContentCursor(encodeContentCursor(timestamp, firstId))).toEqual({
      createdAt: timestamp.toISOString(),
      id: firstId
    });
    expect(decodeCreatorCursor(encodeCreatorCursor("creator_one", firstId))).toEqual({
      handle: "creator_one",
      id: firstId
    });
    expect(decodeHashtagCursor(encodeHashtagCursor("studio"))).toEqual({ slug: "studio" });
    expect(decodeEventCursor(encodeEventCursor(timestamp, secondId))).toEqual({
      startsAt: timestamp.toISOString(),
      id: secondId
    });
    expect(decodeLiveCursor(encodeLiveCursor(timestamp, secondId))).toEqual({
      createdAt: timestamp.toISOString(),
      id: secondId
    });
  });

  it("rejects legacy raw values and cross-group cursor reuse before SQL casts", () => {
    const contentCursor = encodeContentCursor(timestamp, firstId);
    const liveCursor = encodeLiveCursor(timestamp, secondId);

    expect(() => decodeLiveCursor(contentCursor)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeContentCursor(liveCursor)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeLiveCursor(timestamp.toISOString())).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeContentCursor(firstId)).toThrow(InvalidDiscoverCursorError);
    expect(() => decodeHashtagCursor("not-base64!".repeat(80))).toThrow(InvalidDiscoverCursorError);
  });
});
