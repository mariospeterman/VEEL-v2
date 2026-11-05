import { describe, expect, it } from "vitest";
import { bindCursorScope } from "../src/shared/keyset-pagination.js";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  InvalidFeedCursorError,
  StaleFeedCursorError
} from "../src/modules/content/content-feed-cursor.js";

const upperId = "00000000-0000-4000-8000-000000000040";
const afterId = "00000000-0000-4000-8000-000000000020";
const scope = bindCursorScope("content:feed", {
  actor: "viewer-a",
  mode: "latest",
  order: "published_at:desc,id:desc",
  surface: "home"
});

describe("content feed chronological cursor", () => {
  it("round trips exact microsecond upper and continuation boundaries", () => {
    const cursor = encodeFeedCursor({
      scope,
      upper: { publishedAt: "2026-11-05T10:00:00.123456Z", id: upperId },
      after: { publishedAt: "2026-11-05T09:59:59.999999Z", id: afterId }
    });

    expect(decodeFeedCursor(cursor, scope)).toEqual({
      upper: { publishedAt: "2026-11-05T10:00:00.123456Z", id: upperId },
      after: { publishedAt: "2026-11-05T09:59:59.999999Z", id: afterId }
    });
  });

  it("binds continuations to actor, mode, surface, and order", () => {
    const cursor = encodeFeedCursor({
      scope,
      upper: { publishedAt: "2026-11-05T10:00:00.000001Z", id: upperId },
      after: { publishedAt: "2026-11-05T09:00:00.000001Z", id: afterId }
    });
    const otherScope = bindCursorScope("content:feed", {
      actor: "viewer-a",
      mode: "following",
      order: "published_at:desc,id:desc",
      surface: "home"
    });

    expect(() => decodeFeedCursor(cursor, otherScope)).toThrow(InvalidFeedCursorError);
  });

  it.each([
    ["scored-feed", {
      version: 1,
      mode: "recommended",
      surface: "home",
      asOf: "2026-11-05T10:00:00.000Z",
      rankingRevision: "a".repeat(32),
      score: 100,
      createdAt: "2026-11-05T09:00:00.000Z",
      id: afterId
    }],
    ["ranking-session", {
      version: 2,
      mode: "recommended",
      surface: "home",
      sessionId: upperId,
      position: 20
    }]
  ])("returns the deliberate restart error for obsolete %s cursors", (_name, payload) => {
    const legacy = Buffer.from(JSON.stringify(payload)).toString("base64url");

    expect(() => decodeFeedCursor(legacy, scope)).toThrow(StaleFeedCursorError);
  });

  it.each(["", "not base64!", Buffer.from("{}").toString("base64url")])(
    "rejects malformed cursor %s",
    (cursor) => {
      expect(() => decodeFeedCursor(cursor, scope)).toThrow(InvalidFeedCursorError);
    }
  );

  it("rejects timestamps that cannot preserve database ordering precision", () => {
    expect(() => encodeFeedCursor({
      scope,
      upper: { publishedAt: "not-a-time", id: upperId },
      after: { publishedAt: "2026-11-05T09:00:00.000001Z", id: afterId }
    })).toThrow(InvalidFeedCursorError);
  });
});
