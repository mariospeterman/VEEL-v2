import { describe, expect, it } from "vitest";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  InvalidFeedCursorError
} from "../src/modules/content/content-feed-cursor.js";

describe("content feed compound cursor", () => {
  it("round trips the frozen ranking snapshot and stable tuple", () => {
    const cursor = encodeFeedCursor({
      mode: "recommended",
      surface: "home",
      asOf: "2026-08-15T10:00:00.000Z",
      rankingRevision: "0123456789abcdef0123456789abcdef",
      score: 418,
      createdAt: "2026-08-14T09:30:00.000Z",
      id: "00000000-0000-4000-8000-000000000040"
    });

    expect(decodeFeedCursor(cursor)).toEqual({
      version: 1,
      mode: "recommended",
      surface: "home",
      asOf: "2026-08-15T10:00:00.000Z",
      rankingRevision: "0123456789abcdef0123456789abcdef",
      score: 418,
      createdAt: "2026-08-14T09:30:00.000Z",
      id: "00000000-0000-4000-8000-000000000040"
    });
  });

  it.each(["", "not base64!", Buffer.from("{}").toString("base64url")])(
    "rejects malformed cursor %s",
    (cursor) => {
      expect(() => decodeFeedCursor(cursor)).toThrow(InvalidFeedCursorError);
    }
  );

  it.each([
    { score: 2_147_483_648 },
    { createdAt: "2026-08-16T10:00:00.000Z" },
    { asOf: "9999-08-15T10:00:00.000Z" },
    { rankingRevision: "not-a-ranking-fingerprint" }
  ])("rejects an unsafe tuple %#", (override) => {
    const cursor = encodeFeedCursor({
      mode: "recommended",
      surface: "home",
      asOf: "2026-08-15T10:00:00.000Z",
      rankingRevision: "0123456789abcdef0123456789abcdef",
      score: 418,
      createdAt: "2026-08-14T09:30:00.000Z",
      id: "00000000-0000-4000-8000-000000000040",
      ...override
    });
    expect(() => decodeFeedCursor(cursor)).toThrow(InvalidFeedCursorError);
  });
});
