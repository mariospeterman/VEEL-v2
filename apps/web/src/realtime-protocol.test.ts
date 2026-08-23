import { describe, expect, it } from "vitest";
import {
  acceptRealtimeVersion,
  parseRealtimeInvalidation,
  shouldRecoverRealtimeGap
} from "./realtime-protocol";

describe("scoped realtime invalidation protocol", () => {
  it("rejects malformed or unversioned transport payloads", () => {
    expect(parseRealtimeInvalidation(null)).toBeNull();
    expect(parseRealtimeInvalidation({ event: "insert", resourceKind: "messages", resourceId: "m1", version: 0 })).toBeNull();
    expect(parseRealtimeInvalidation({ event: "insert", resourceKind: "messages", resourceId: "m1", version: 1 })).toEqual({
      event: "insert",
      resourceKind: "messages",
      resourceId: "m1",
      version: 1
    });
  });

  it("deduplicates by private topic without leaking versions across conversations", () => {
    const versions = new Map<string, number>();
    expect(acceptRealtimeVersion(versions, "conversation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2)).toBe(true);
    expect(acceptRealtimeVersion(versions, "conversation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2)).toBe(false);
    expect(acceptRealtimeVersion(versions, "conversation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1)).toBe(false);
    expect(acceptRealtimeVersion(versions, "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1)).toBe(true);
  });

  it("recovers canonical API state after every successful subscription or reconnect", () => {
    expect(shouldRecoverRealtimeGap("SUBSCRIBED")).toBe(true);
    expect(shouldRecoverRealtimeGap("CHANNEL_ERROR")).toBe(false);
    expect(shouldRecoverRealtimeGap("TIMED_OUT")).toBe(false);
  });
});
