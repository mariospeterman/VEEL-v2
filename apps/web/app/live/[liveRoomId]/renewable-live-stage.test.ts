// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRoom } from "@/api-client";
import { ApiMutationError } from "@/api-mutations";
import { RenewableLiveStage } from "./renewable-live-stage";

const mutationMocks = vi.hoisted(() => ({
  getLiveRoomForMutation: vi.fn()
}));

vi.mock("@/api-mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api-mutations")>();
  return {
    ...actual,
    getLiveRoomForMutation: mutationMocks.getLiveRoomForMutation
  };
});

vi.mock("../../provider-playback", async () => {
  const { createElement } = await import("react");
  return {
    ProviderPlayback({
      onAccessRefresh,
      playback
    }: {
      onAccessRefresh?: () => Promise<unknown>;
      playback?: { jwt?: string | null; url?: string | null } | null;
    }) {
      return createElement(
        "section",
        {
          "data-jwt": playback?.jwt ?? "",
          "data-testid": "provider-playback",
          "data-url": playback?.url ?? ""
        },
        createElement(
          "button",
          {
            onClick: () => { void onAccessRefresh?.(); },
            type: "button"
          },
          "Refresh access"
        )
      );
    }
  };
});

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let reject!: Deferred<T>["reject"];
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function liveRoom(resource: string): LiveRoom {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Regression live",
    creator: {
      id: "22222222-2222-4222-8222-222222222222",
      handle: "creator",
      displayName: "Creator",
      badges: []
    },
    state: "live",
    safetyState: "approved",
    accessMode: "public",
    accessState: "allowed",
    playback: {
      state: "full",
      url: `https://playback.example/${resource}.m3u8`,
      provider: "livepeer",
      resourceType: "hls",
      jwt: `jwt-${resource}`,
      expiresAt: "2099-01-01T00:00:00.000Z"
    },
    previewSecondsRemaining: null,
    eventAccess: null,
    chat: {
      enabled: true,
      accessState: "allowed"
    },
    replayContentId: null
  };
}

describe("RenewableLiveStage refresh authority", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mutationMocks.getLiveRoomForMutation.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderRoom(room: LiveRoom) {
    await act(async () => {
      root.render(createElement(RenewableLiveStage, { room }));
    });
  }

  function playbackProbe(): HTMLElement {
    const probe = container.querySelector<HTMLElement>("[data-testid='provider-playback']");
    expect(probe).not.toBeNull();
    return probe!;
  }

  async function startRefresh() {
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
  }

  it.each([
    ["success", (request: Deferred<LiveRoom>) => request.resolve(liveRoom("late-a"))],
    ["authoritative denial", (request: Deferred<LiveRoom>) => request.reject(new ApiMutationError("denied", 403))]
  ] as const)("keeps installed resource B usable after refresh A returns a stale %s", async (_outcome, settle) => {
    const refreshA = createDeferred<LiveRoom>();
    mutationMocks.getLiveRoomForMutation.mockReturnValueOnce(refreshA.promise);

    await renderRoom(liveRoom("a"));
    await startRefresh();
    expect(mutationMocks.getLiveRoomForMutation).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");

    await renderRoom(liveRoom("b"));
    expect(playbackProbe().dataset.url).toBe("https://playback.example/b.m3u8");
    expect(playbackProbe().dataset.jwt).toBe("jwt-b");

    await act(async () => {
      settle(refreshA);
      await refreshA.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(playbackProbe().dataset.url).toBe("https://playback.example/b.m3u8");
    expect(playbackProbe().dataset.jwt).toBe("jwt-b");
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.textContent).not.toContain("Live playback unavailable");
  });

  it("closes access when the current resource receives an authoritative denial", async () => {
    mutationMocks.getLiveRoomForMutation.mockRejectedValueOnce(new ApiMutationError("denied", 403));

    await renderRoom(liveRoom("current"));
    await startRefresh();

    expect(container.querySelector("[data-testid='provider-playback']")).toBeNull();
    expect(container.textContent).toContain("Live playback unavailable");
  });
});
