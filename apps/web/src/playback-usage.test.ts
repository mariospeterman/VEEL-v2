import type { components } from "@veel/contracts";
import { describe, expect, it } from "vitest";
import {
  playbackLeaseAction,
  playbackSessionExhausted,
  playbackSessionNeedsRotation
} from "./playback-usage";

type Usage = components["schemas"]["PlaybackUsageContext"];
type Session = components["schemas"]["PlatformPlaybackSession"];

const usage: Usage = {
  policy: "public_media_allowance",
  targetType: "content",
  targetId: "00000000-0000-4000-8000-000000000040",
  heartbeatIntervalSeconds: 15,
  leaseExpiresAt: null
};

describe("server-authoritative playback leases", () => {
  it("reserves before the first resource and refreshes without a second debit inside the lease", () => {
    const now = Date.parse("2026-11-05T12:00:00.000Z");
    expect(playbackLeaseAction(usage, now)).toBe("reserve");
    expect(playbackLeaseAction({
      ...usage,
      leaseExpiresAt: "2026-11-05T12:05:00.000Z"
    }, now)).toBe("refresh");
    expect(playbackLeaseAction({
      ...usage,
      leaseExpiresAt: "2026-11-05T11:59:59.000Z"
    }, now)).toBe("reserve");
  });

  it("reuses the session when only the provider capability expires", () => {
    const now = Date.parse("2026-11-05T12:00:00.000Z");
    const session: Session = {
      id: "00000000-0000-4000-8000-000000000085",
      state: "active",
      heartbeatIntervalSeconds: 15,
      consumedSeconds: 12,
      reservedSeconds: 900,
      leaseExpiresAt: "2026-11-05T12:15:00.000Z",
      usage: {
        windowStartsAt: "2026-11-01T00:00:00.000Z",
        windowEndsAt: "2026-12-01T00:00:00.000Z",
        publicMediaSeconds: 900,
        remainingPublicMediaSeconds: 71100,
        limitReached: false
      }
    };

    expect(playbackLeaseAction({
      ...usage,
      leaseExpiresAt: session.leaseExpiresAt
    }, now)).toBe("refresh");
    expect(playbackSessionNeedsRotation(session, now)).toBe(false);
  });

  it("rotates the cached session only after its allowance lease expires", () => {
    const now = Date.parse("2026-11-05T12:15:00.000Z");
    const session: Session = {
      id: "00000000-0000-4000-8000-000000000085",
      state: "active",
      heartbeatIntervalSeconds: 15,
      consumedSeconds: 12,
      reservedSeconds: 900,
      leaseExpiresAt: "2026-11-05T12:15:00.000Z",
      usage: {
        windowStartsAt: "2026-11-01T00:00:00.000Z",
        windowEndsAt: "2026-12-01T00:00:00.000Z",
        publicMediaSeconds: 900,
        remainingPublicMediaSeconds: 71100,
        limitReached: false
      }
    };

    expect(playbackLeaseAction({ ...usage, leaseExpiresAt: null }, now)).toBe("reserve");
    expect(playbackSessionNeedsRotation(session, now)).toBe(true);
  });

  it("keeps the final reserved chunk playable after usage reaches the monthly limit", () => {
    const finalChunk: Session = {
      id: "00000000-0000-4000-8000-000000000085",
      state: "active",
      heartbeatIntervalSeconds: 15,
      consumedSeconds: 0,
      reservedSeconds: 37,
      leaseExpiresAt: "2026-11-05T12:00:37.000Z",
      usage: {
        windowStartsAt: "2026-11-01T00:00:00.000Z",
        windowEndsAt: "2026-12-01T00:00:00.000Z",
        publicMediaSeconds: 72000,
        remainingPublicMediaSeconds: 0,
        limitReached: true
      }
    };

    expect(playbackSessionExhausted(finalChunk)).toBe(false);
    expect(playbackSessionExhausted({ ...finalChunk, state: "expired" })).toBe(true);
    expect(playbackSessionExhausted({
      ...finalChunk,
      reservedSeconds: 0
    })).toBe(true);
  });
});
