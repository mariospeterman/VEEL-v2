import { describe, expect, it, vi } from "vitest";
import { loadReachableMomentContinuation } from "./reachable-moment-page";

const page = (ids: string[], nextCursor: string | null) => ({
  items: ids.map((id) => ({ id })),
  mode: "latest" as const,
  nextCursor
});

describe("reachable Moment continuation", () => {
  it("automatically crosses empty eligible batches to reach a later moment", async () => {
    const readNext = vi.fn(async (cursor: string) => {
      if (cursor === "candidate-2") return page([], "candidate-3");
      if (cursor === "candidate-3") return page(["eligible-moment"], "candidate-4");
      throw new Error(`Unexpected cursor ${cursor}`);
    });

    const result = await loadReachableMomentContinuation(
      page([], "candidate-2"),
      readNext
    );

    expect(readNext.mock.calls.map(([cursor]) => cursor)).toEqual([
      "candidate-2",
      "candidate-3"
    ]);
    expect(result.items.map((item) => item.id)).toEqual(["eligible-moment"]);
    expect(result.nextCursor).toBe("candidate-4");
  });

  it("bounds one scan and preserves its continuation for a later load-more attempt", async () => {
    const readNext = vi.fn(async (cursor: string) => {
      const pageNumber = Number(cursor.slice("candidate-".length));
      return page(
        pageNumber === 4 ? ["later-eligible-moment"] : [],
        `candidate-${pageNumber + 1}`
      );
    });

    const bounded = await loadReachableMomentContinuation(
      page([], "candidate-1"),
      readNext,
      2
    );
    expect(bounded.items).toEqual([]);
    expect(bounded.nextCursor).toBe("candidate-3");
    expect(readNext).toHaveBeenCalledTimes(2);

    const loadedMore = await loadReachableMomentContinuation(bounded, readNext, 2);
    expect(loadedMore.items.map((item) => item.id)).toEqual(["later-eligible-moment"]);
    expect(readNext).toHaveBeenCalledTimes(4);
  });

  it("stops a repeated cursor instead of looping or offering it forever", async () => {
    const readNext = vi.fn(async () => page([], "candidate-loop"));

    const result = await loadReachableMomentContinuation(
      page([], "candidate-loop"),
      readNext
    );

    expect(readNext).toHaveBeenCalledOnce();
    expect(result).toEqual(page([], null));
  });
});
