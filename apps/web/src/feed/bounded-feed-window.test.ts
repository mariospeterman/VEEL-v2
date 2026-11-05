import { describe, expect, it } from "vitest";
import {
  advanceFeedWindowAfterAppend,
  calculateFeedSpacerHeight,
  createFeedWindow,
  maxRenderedFeedItems,
  mergeFeedItems,
  moveFeedWindow
} from "./bounded-feed-window";

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe("bounded feed window", () => {
  it("deduplicates incoming pages without replacing mounted item identities", () => {
    const current = items("a", "b");
    const duplicate = { id: "b" };
    const merged = mergeFeedItems(current, [duplicate, { id: "c" }, { id: "c" }]);

    expect(merged).toEqual(items("a", "b", "c"));
    expect(merged[1]).toBe(current[1]);
    expect(merged[1]).not.toBe(duplicate);
  });

  it("keeps the DOM range bounded while walking forward and backward", () => {
    const initial = createFeedWindow(100);
    const forward = moveFeedWindow(initial, 100, "forward");
    const backward = moveFeedWindow(forward, 100, "backward");

    expect(initial).toEqual({ start: 0, end: maxRenderedFeedItems });
    expect(forward).toEqual({ start: 20, end: 80 });
    expect(backward).toEqual(initial);
    expect(forward.end - forward.start).toBe(maxRenderedFeedItems);
  });

  it("can traverse the full bounded ranking session in either direction", () => {
    const itemCount = 512;
    let current = createFeedWindow(itemCount);
    const covered = new Set<number>();

    while (true) {
      for (let index = current.start; index < current.end; index += 1) covered.add(index);
      expect(current.end - current.start).toBeLessThanOrEqual(maxRenderedFeedItems);
      if (current.end === itemCount) break;
      const next = moveFeedWindow(current, itemCount, "forward");
      expect(next).not.toEqual(current);
      current = next;
    }

    expect(covered.size).toBe(itemCount);
    while (current.start > 0) {
      const previous = moveFeedWindow(current, itemCount, "backward");
      expect(previous).not.toEqual(current);
      expect(previous.end - previous.start).toBeLessThanOrEqual(maxRenderedFeedItems);
      current = previous;
    }
    expect(current).toEqual({ start: 0, end: maxRenderedFeedItems });
  });

  it("retains an anchor in the overlapping range so focus and the active card survive a shift", () => {
    const current = { start: 20, end: 80 };

    expect(moveFeedWindow(current, 120, "forward", 60, 25)).toEqual({ start: 25, end: 85 });
    expect(moveFeedWindow(current, 120, "backward", 60, 74)).toEqual({ start: 15, end: 75 });
  });

  it("reveals newly appended cards when the current window is at the loaded tail", () => {
    expect(advanceFeedWindowAfterAppend({ start: 0, end: 60 }, 60, 80)).toEqual({
      start: 20,
      end: 80
    });
  });

  it("does not jump a reader away from a cached middle window when a page appends", () => {
    expect(advanceFeedWindowAfterAppend({ start: 20, end: 80 }, 100, 120)).toEqual({
      start: 20,
      end: 80
    });
  });

  it("builds aggregate spacers from measured heights and a bounded estimate", () => {
    const feed = items("a", "b", "c");
    const heights = new Map([["a", 100], ["c", 140]]);

    expect(calculateFeedSpacerHeight(feed, 0, 3, heights, 120, 18)).toBe(396);
    expect(calculateFeedSpacerHeight(feed, 1, 1, heights, 120, 18)).toBe(0);
  });

  it("normalizes empty counts and invalid limits without creating an invalid range", () => {
    expect(createFeedWindow(0, 0)).toEqual({ start: 0, end: 0 });
    expect(createFeedWindow(3, 0)).toEqual({ start: 0, end: 1 });
    expect(moveFeedWindow({ start: 20, end: 80 }, 0, "backward")).toEqual({ start: 0, end: 0 });
  });
});
