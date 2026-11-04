import { describe, expect, it } from "vitest";
import { retainNewestFeedItems } from "./bounded-feed-window";

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe("bounded feed window", () => {
  it("deduplicates incoming pages", () => {
    expect(retainNewestFeedItems(items("a", "b"), items("b", "c"), 4)).toEqual({
      evicted: [],
      items: items("a", "b", "c")
    });
  });

  it("evicts the oldest cards when the DOM budget is exceeded", () => {
    expect(retainNewestFeedItems(items("a", "b", "c"), items("d", "e"), 3)).toEqual({
      evicted: items("a", "b"),
      items: items("c", "d", "e")
    });
  });

  it("keeps at least one card for invalid limits", () => {
    expect(retainNewestFeedItems(items("a"), items("b"), 0).items).toEqual(items("b"));
  });
});
