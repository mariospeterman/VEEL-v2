import { describe, expect, it, vi } from "vitest";
import {
  coalesceContentAccessRefresh,
  contentAccessSourceKey,
  createContentAccessRetryScheduler,
  isAuthoritativeContentAccessDenial
} from "./content-access-refresh";

describe("coalesceContentAccessRefresh", () => {
  it("shares one in-flight canonical refresh for the same content item", async () => {
    let release: ((value: string) => void) | undefined;
    const load = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));

    const first = coalesceContentAccessRefresh("content-a", load);
    const second = coalesceContentAccessRefresh("content-a", load);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    release?.("renewed");
    await expect(first).resolves.toBe("renewed");
  });

  it("does not cache signed resources after completion", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await expect(coalesceContentAccessRefresh("content-b", load)).resolves.toBe("first");
    await expect(coalesceContentAccessRefresh("content-b", load)).resolves.toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("clears failed requests so a later bounded retry can recover", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("recovered");

    await expect(coalesceContentAccessRefresh("content-c", load)).rejects.toThrow("temporary");
    await expect(coalesceContentAccessRefresh("content-c", load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not merge refreshes for different content authorities", async () => {
    const loadA = vi.fn().mockResolvedValue("a");
    const loadB = vi.fn().mockResolvedValue("b");

    await expect(Promise.all([
      coalesceContentAccessRefresh("content-d", loadA),
      coalesceContentAccessRefresh("content-e", loadB)
    ])).resolves.toEqual(["a", "b"]);
    expect(loadA).toHaveBeenCalledOnce();
    expect(loadB).toHaveBeenCalledOnce();
  });

  it("does not merge an in-flight refresh across viewer-scoped access keys", async () => {
    let releaseViewerA: ((value: string) => void) | undefined;
    const loadViewerA = vi.fn(() => new Promise<string>((resolve) => {
      releaseViewerA = resolve;
    }));
    const loadViewerB = vi.fn().mockResolvedValue("viewer-b");

    const viewerA = coalesceContentAccessRefresh("content-f:viewer-a", loadViewerA);
    const viewerB = coalesceContentAccessRefresh("content-f:viewer-b", loadViewerB);

    await expect(viewerB).resolves.toBe("viewer-b");
    expect(loadViewerA).toHaveBeenCalledOnce();
    expect(loadViewerB).toHaveBeenCalledOnce();

    releaseViewerA?.("viewer-a");
    await expect(viewerA).resolves.toBe("viewer-a");
  });

  it("invalidates local renewed state when viewer-scoped image access changes", () => {
    const base = {
      id: "content-a",
      compositionRevision: 3,
      posterUrl: null,
      mediaAssets: [{
        id: "asset-a",
        posterUrl: "https://cdn.example/safe-preview.webp",
        imageDelivery: {
          url: "https://cdn.example/original.webp?token=viewer-a",
          expiresAt: "2026-11-05T10:00:00.000Z",
          variants: [{ url: "https://cdn.example/640.webp?token=viewer-a" }]
        }
      }]
    };
    const switchedViewer = {
      ...base,
      mediaAssets: [{
        ...base.mediaAssets[0]!,
        imageDelivery: {
          ...base.mediaAssets[0]!.imageDelivery,
          url: "https://cdn.example/original.webp?token=viewer-b",
          variants: [{ url: "https://cdn.example/640.webp?token=viewer-b" }]
        }
      }]
    };

    expect(contentAccessSourceKey(switchedViewer)).not.toBe(contentAccessSourceKey(base));
  });

  it("invalidates blocked playback after an explicit lease returns a signed resource", () => {
    const blocked = {
      id: "content-video",
      playback: {
        state: "blocked",
        url: null,
        expiresAt: null,
        blockReason: "playback_lease_required",
        usage: {
          targetType: "content",
          targetId: "content-video",
          leaseExpiresAt: null
        }
      }
    };
    const leased = {
      ...blocked,
      playback: {
        state: "full",
        url: "https://player.mediadelivery.net/embed/library/video?token=opaque",
        expiresAt: "2026-11-05T12:15:00.000Z",
        blockReason: null,
        usage: {
          ...blocked.playback.usage,
          leaseExpiresAt: "2026-11-05T12:15:00.000Z"
        }
      }
    };

    expect(contentAccessSourceKey(leased)).not.toBe(contentAccessSourceKey(blocked));
  });

  it("invalidates carousel playback when only an asset lease changes", () => {
    const blocked = {
      id: "content-carousel",
      mediaAssets: [{
        id: "asset-video",
        playback: {
          state: "blocked",
          url: null,
          expiresAt: null,
          blockReason: "playback_lease_required",
          usage: {
            targetType: "content",
            targetId: "content-carousel",
            leaseExpiresAt: null
          }
        }
      }]
    };
    const leased = {
      ...blocked,
      mediaAssets: [{
        ...blocked.mediaAssets[0]!,
        playback: {
          ...blocked.mediaAssets[0]!.playback,
          state: "full",
          url: "https://media.example/signed",
          expiresAt: "2026-11-05T12:15:00.000Z",
          blockReason: null,
          usage: {
            ...blocked.mediaAssets[0]!.playback.usage,
            leaseExpiresAt: "2026-11-05T12:15:00.000Z"
          }
        }
      }]
    };

    expect(contentAccessSourceKey(leased)).not.toBe(contentAccessSourceKey(blocked));
  });

  it("backs transient failures off, coalesces timers, and stops after the bounded budget", () => {
    const timers: Array<{ callback: () => void; delayMs: number; handle: number }> = [];
    const cleared: number[] = [];
    let nextHandle = 1;
    const scheduler = createContentAccessRetryScheduler({
      setTimer(callback, delayMs) {
        const handle = nextHandle++;
        timers.push({ callback, delayMs, handle });
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer(handle) {
        cleared.push(handle as unknown as number);
      }
    });
    const retry = vi.fn();

    expect(scheduler.schedule(retry)).toBe(true);
    expect(scheduler.schedule(retry)).toBe(false);
    expect(timers[0]?.delayMs).toBe(5_000);
    timers[0]?.callback();
    expect(retry).toHaveBeenCalledOnce();

    expect(scheduler.schedule(retry)).toBe(true);
    expect(timers[1]?.delayMs).toBe(15_000);
    timers[1]?.callback();
    expect(scheduler.schedule(retry)).toBe(true);
    expect(timers[2]?.delayMs).toBe(30_000);
    timers[2]?.callback();
    expect(scheduler.schedule(retry)).toBe(false);

    scheduler.reset();
    expect(scheduler.schedule(retry)).toBe(true);
    expect(timers[3]?.delayMs).toBe(5_000);
    scheduler.dispose();
    expect(cleared).toContain(timers[3]?.handle);
    expect(scheduler.schedule(retry)).toBe(false);
  });

  it("fails closed only for authoritative access responses", () => {
    expect([401, 403, 404, 410].every(isAuthoritativeContentAccessDenial)).toBe(true);
    expect(isAuthoritativeContentAccessDenial(500)).toBe(false);
    expect(isAuthoritativeContentAccessDenial(undefined)).toBe(false);
  });
});
