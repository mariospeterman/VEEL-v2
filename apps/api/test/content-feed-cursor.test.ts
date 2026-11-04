import { describe, expect, it } from "vitest";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  InvalidFeedCursorError
} from "../src/modules/content/content-feed-cursor.js";

describe("content feed compound cursor", () => {
  it("round trips the bounded ranking session and last delivered position", () => {
    const cursor = encodeFeedCursor({
      mode: "recommended",
      surface: "home",
      sessionId: "00000000-0000-4000-8000-000000000040",
      position: 20
    });

    expect(decodeFeedCursor(cursor)).toEqual({
      version: 2,
      mode: "recommended",
      surface: "home",
      sessionId: "00000000-0000-4000-8000-000000000040",
      position: 20
    });
  });

  it.each(["", "not base64!", Buffer.from("{}").toString("base64url")])(
    "rejects malformed cursor %s",
    (cursor) => {
      expect(() => decodeFeedCursor(cursor)).toThrow(InvalidFeedCursorError);
    }
  );

  it.each([
    { position: 0 },
    { position: 513 },
    { position: 1.5 },
    { sessionId: "not-a-session-id" }
  ])("rejects an unsafe session cursor %#", (override) => {
    const cursor = encodeFeedCursor({
      mode: "recommended",
      surface: "home",
      sessionId: "00000000-0000-4000-8000-000000000040",
      position: 20,
      ...override
    });
    expect(() => decodeFeedCursor(cursor)).toThrow(InvalidFeedCursorError);
  });
});
