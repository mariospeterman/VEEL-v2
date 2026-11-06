import { describe, expect, it, vi } from "vitest";
import { restoreAuthorizedFeedView } from "./authorized-feed-view-restore";

const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map((id) => ({ id, authorized: true })),
  nextCursor,
  mode: "latest" as const
});

describe("authorized feed view restore", () => {
  it("never restores cached resources and drops IDs removed by current policy", async () => {
    const cachedResources = page(["safe", "now-hidden", "adult"]);
    const fresh = page(["safe", "new-safe"]);

    const restored = await restoreAuthorizedFeedView(fresh, {
      activeId: "now-hidden",
      itemIds: cachedResources.items.map((item) => item.id),
      measuredHeights: [["safe", 100], ["now-hidden", 120]],
      renderWindow: { start: 0, end: 3 },
      scrollTop: 900
    }, vi.fn());

    expect(restored.page.items.map((item) => item.id)).toEqual(["safe", "new-safe"]);
    expect(restored.measuredHeights).toEqual([["safe", 100]]);
    expect(restored.activeId).toBe("new-safe");
    expect(restored.scrollTop).toBeNull();
  });

  it("reauthorizes later pages before restoring an exact active item and position", async () => {
    const readNext = vi.fn(async (cursor: string) => {
      expect(cursor).toBe("next-1");
      return page(["c", "d"], null);
    });

    const restored = await restoreAuthorizedFeedView(page(["a", "b"], "next-1"), {
      activeId: "d",
      itemIds: ["a", "b", "c", "d"],
      measuredHeights: [["d", 140]],
      renderWindow: { start: 0, end: 4 },
      scrollTop: 640
    }, readNext);

    expect(readNext).toHaveBeenCalledOnce();
    expect(restored.page.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(restored.activeId).toBe("d");
    expect(restored.scrollTop).toBe(640);
  });

  it("bounds reauthorization and stops when the fresh cursor is exhausted", async () => {
    const readNext = vi.fn(async (cursor: string) => page([cursor], `${cursor}-next`));

    const restored = await restoreAuthorizedFeedView(page(["a"], "cursor"), {
      activeId: "missing",
      itemIds: Array.from({ length: 100 }, (_, index) => `old-${index}`),
      measuredHeights: [],
      renderWindow: { start: 60, end: 100 },
      scrollTop: 10_000
    }, readNext, 2);

    expect(readNext).toHaveBeenCalledTimes(2);
    expect(restored.page.items).toHaveLength(3);
    expect(restored.scrollTop).toBeNull();
  });
});
